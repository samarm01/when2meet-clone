'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface Poll {
  id: string;
  title: string;
  timezone: string;
  dates: string[]; // e.g. ["2026-09-24", "2026-09-25"]
  start_hour: number;
  end_hour: number;
  interval_minutes: number;
}

interface Availability {
  id: string;
  poll_id: string;
  participant_name: string;
  slots: string[]; // ISO timestamps
}

export default function PollPage() {
  const params = useParams();
  const pollId = params?.id as string;

  const [poll, setPoll] = useState<Poll | null>(null);
  const [availabilities, setAvailabilities] = useState<Availability[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Mobile / Form Range Input State
  const [formDate, setFormDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('12:00');

  // Hover & Drag State
  const [hoveredSlot, setHoveredSlot] = useState<string | null>(null);
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [dragMode, setDragMode] = useState<'add' | 'remove'>('add');

  // Theme Color State (RGB format, default Emerald)
  const [themeColor, setThemeColor] = useState('16, 185, 129');

  // Toast Notification State
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => {
      setToast(null);
    }, 3000);
  }

  // 1. Fetch Poll & Availability Data + Realtime Subscription
  useEffect(() => {
    if (!pollId) return;

    async function fetchPollData() {
      try {
        const { data: pollData, error: pollError } = await supabase
          .from('polls')
          .select('*')
          .eq('id', pollId)
          .single();

        if (pollError) throw pollError;
        setPoll(pollData);
        if (pollData.dates.length > 0) {
          setFormDate(pollData.dates[0]);
        }

        // Set dynamic browser tab title
        document.title = `${pollData.title} | when2matt`;

        const { data: availData, error: availError } = await supabase
          .from('availabilities')
          .select('*')
          .eq('poll_id', pollId);

        if (availError) throw availError;
        setAvailabilities(availData || []);
      } catch (err: any) {
        setError(err.message || 'Error fetching poll');
      } finally {
        setLoading(false);
      }
    }

    fetchPollData();

    // Postgres Realtime listener
    const channel = supabase
      .channel(`poll-${pollId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'availabilities', filter: `poll_id=eq.${pollId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setAvailabilities((prev) => [...prev, payload.new as Availability]);
          } else if (payload.eventType === 'UPDATE') {
            setAvailabilities((prev) =>
              prev.map((item) => (item.id === payload.new.id ? (payload.new as Availability) : item))
            );
          } else if (payload.eventType === 'DELETE') {
            setAvailabilities((prev) => prev.filter((item) => item.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [pollId]);

  // 2. Global mouse-up listener to handle dragging outside boundaries
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsMouseDown(false);
    };

    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, []);

  // 3. Build time labels (e.g., 09:00, 09:30, ...)
  const timeLabels = useMemo(() => {
    if (!poll) return [];
    const labels: string[] = [];
    for (let hour = poll.start_hour; hour < poll.end_hour; hour++) {
      for (let min = 0; min < 60; min += poll.interval_minutes) {
        const hStr = hour.toString().padStart(2, '0');
        const mStr = min.toString().padStart(2, '0');
        labels.push(`${hStr}:${mStr}`);
      }
    }
    return labels;
  }, [poll]);

  // 4. Heatmap Frequency Map
  const heatmap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const record of availabilities) {
      for (const slot of record.slots) {
        if (!map[slot]) map[slot] = [];
        map[slot].push(record.participant_name);
      }
    }
    return map;
  }, [availabilities]);

  // Mouse Drag Handlers
  function handleCellMouseDown(slotKey: string, e: React.MouseEvent) {
    e.preventDefault();
    const mode = selectedSlots.has(slotKey) ? 'remove' : 'add';
    setDragMode(mode);
    setIsMouseDown(true);

    setSelectedSlots((prev) => {
      const next = new Set(prev);
      if (mode === 'add') {
        next.add(slotKey);
      } else {
        next.delete(slotKey);
      }
      return next;
    });
  }

  function handleCellMouseEnter(slotKey: string) {
    setHoveredSlot(slotKey);

    if (!isMouseDown) return;

    setSelectedSlots((prev) => {
      const next = new Set(prev);
      if (dragMode === 'add') {
        next.add(slotKey);
      } else {
        next.delete(slotKey);
      }
      return next;
    });
  }

  // 5. Form Range Selector with Automatic Interval Snapping
  function handleSelectRange(e: React.FormEvent) {
    e.preventDefault();
    if (!formDate || !startTime || !endTime) return;
    if (startTime >= endTime) {
      showToast('End time must be after start time.');
      return;
    }

    const interval = poll?.interval_minutes || 30;

    let [startH, startM] = startTime.split(':').map(Number);
    let [endH, endM] = endTime.split(':').map(Number);

    // Snap start DOWN to nearest slot boundary (e.g. 09:15 -> 09:00)
    startM = Math.floor(startM / interval) * interval;

    // Snap end UP to nearest slot boundary (e.g. 11:15 -> 11:30)
    if (endM % interval !== 0) {
      endM = Math.ceil(endM / interval) * interval;
      if (endM >= 60) {
        endH += Math.floor(endM / 60);
        endM = endM % 60;
      }
    }

    const newSlots = new Set(selectedSlots);
    let h = startH;
    let m = startM;

    while (h < endH || (h === endH && m < endM)) {
      const slotKey = `${formDate}T${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      newSlots.add(slotKey);

      m += interval;
      if (m >= 60) {
        h += Math.floor(m / 60);
        m = m % 60;
      }
    }

    setSelectedSlots(newSlots);
    showToast('Time range highlighted!');
  }

  function handleClear() {
    setSelectedSlots(new Set());
    showToast('Selections cleared.');
  }

  // 6. Save availability to Supabase
  async function handleSaveAvailability() {
    if (!name.trim()) {
      showToast('Please enter your name first.');
      return;
    }

    setSaving(true);
    try {
      const slotsArray = Array.from(selectedSlots);

      const existing = availabilities.find(
        (a) => a.participant_name.toLowerCase() === name.trim().toLowerCase()
      );

      if (existing) {
        const { error } = await supabase
          .from('availabilities')
          .update({ slots: slotsArray })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('availabilities')
          .insert([
            {
              poll_id: pollId,
              participant_name: name.trim(),
              slots: slotsArray,
            },
          ]);
        if (error) throw error;
      }

      showToast('Availability saved successfully!');
    } catch (err: any) {
      showToast(err.message || 'Error saving availability.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500 font-medium">
        Loading poll...
      </div>
    );
  }

  if (error || !poll) {
    return (
      <div className="min-h-screen flex items-center justify-center text-red-600 font-medium">
        Poll not found.
      </div>
    );
  }

  const totalParticipants = availabilities.length;

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6 relative">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white px-4 py-3 rounded-lg shadow-xl text-sm font-medium border border-slate-700 animate-fade-in flex items-center gap-2">
          <span>🔔</span>
          <span>{toast}</span>
        </div>
      )}

      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Header */}
        <header className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                when2matt
              </span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mt-1">{poll.title}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {totalParticipants} participant{totalParticipants === 1 ? '' : 's'} responded
            </p>
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              showToast('Poll link copied to clipboard!');
            }}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg border border-slate-300 transition flex items-center gap-1.5"
          >
            📋 Copy Share Link
          </button>
        </header>

        {/* Input Panel (Mobile Quick-Select & Name) */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wider mb-3">
            1. Enter Details & Quick-Select Time
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Your Name</label>
              <input
                type="text"
                placeholder="e.g. Alex"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Date</label>
              <select
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none"
              >
                {poll.dates.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">From</label>
              <input
                type="time"
                step="1800"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">To</label>
              <input
                type="time"
                step="1800"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSelectRange}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg shadow-sm transition"
              >
                + Select Time Range
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-semibold rounded-lg transition"
              >
                Clear Selections
              </button>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={handleSaveAvailability}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save My Availability'}
            </button>
          </div>
        </div>

        {/* Interactive Heatmap & Drag Selection Grid */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">
                2. Availability Grid
              </h2>

              {/* Theme Palette Swatches (Emerald, Blue, Violet, Rose, Orange) */}
              <div className="flex items-center gap-1.5 border-l border-slate-300 pl-3">
                <button
                  type="button"
                  onClick={() => setThemeColor('16, 185, 129')}
                  className={`w-5 h-5 rounded-full bg-emerald-500 transition ${
                    themeColor === '16, 185, 129' ? 'ring-2 ring-offset-2 ring-emerald-500 scale-110' : 'opacity-80 hover:opacity-100'
                  }`}
                  title="Emerald Green"
                />
                <button
                  type="button"
                  onClick={() => setThemeColor('59, 130, 246')}
                  className={`w-5 h-5 rounded-full bg-blue-500 transition ${
                    themeColor === '59, 130, 246' ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : 'opacity-80 hover:opacity-100'
                  }`}
                  title="Blue"
                />
                <button
                  type="button"
                  onClick={() => setThemeColor('139, 92, 246')}
                  className={`w-5 h-5 rounded-full bg-violet-500 transition ${
                    themeColor === '139, 92, 246' ? 'ring-2 ring-offset-2 ring-violet-500 scale-110' : 'opacity-80 hover:opacity-100'
                  }`}
                  title="Violet"
                />
                <button
                  type="button"
                  onClick={() => setThemeColor('244, 63, 94')}
                  className={`w-5 h-5 rounded-full bg-rose-500 transition ${
                    themeColor === '244, 63, 94' ? 'ring-2 ring-offset-2 ring-rose-500 scale-110' : 'opacity-80 hover:opacity-100'
                  }`}
                  title="Rose"
                />
                <button
                  type="button"
                  onClick={() => setThemeColor('249, 115, 22')}
                  className={`w-5 h-5 rounded-full bg-orange-500 transition ${
                    themeColor === '249, 115, 22' ? 'ring-2 ring-offset-2 ring-orange-500 scale-110' : 'opacity-80 hover:opacity-100'
                  }`}
                  title="Orange"
                />
              </div>
            </div>

            {hoveredSlot && (
              <div className="text-xs bg-slate-100 text-slate-700 px-2.5 py-1.5 rounded-md border border-slate-200 font-medium">
                <span className="text-slate-900 font-bold">{hoveredSlot}: </span>
                {heatmap[hoveredSlot]?.length
                  ? `${heatmap[hoveredSlot].join(', ')} (${heatmap[hoveredSlot].length}/${totalParticipants})`
                  : 'No one available'}
              </div>
            )}
          </div>

          <div className="inline-block min-w-full select-none">
            <table className="border-collapse select-none">
              <thead>
                <tr>
                  <th className="p-2 text-xs font-semibold text-slate-400 border border-slate-200 bg-slate-50 w-20">
                    Time
                  </th>
                  {poll.dates.map((dateStr) => {
                    const d = new Date(dateStr + 'T00:00:00');
                    return (
                      <th
                        key={dateStr}
                        className="p-2 text-xs font-semibold text-slate-700 border border-slate-200 bg-slate-50 text-center min-w-[96px]"
                      >
                        {d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {timeLabels.map((time) => (
                  <tr key={time}>
                    <td className="p-1 text-[11px] font-mono text-slate-400 border border-slate-200 text-center bg-slate-50 select-none">
                      {time}
                    </td>
                    {poll.dates.map((dateStr) => {
                      const slotKey = `${dateStr}T${time}`;
                      const isSelected = selectedSlots.has(slotKey);
                      const availablePeople = heatmap[slotKey] || [];
                      const count = availablePeople.length;
                      const ratio = totalParticipants > 0 ? count / totalParticipants : 0;

                      // Heatmap color calculation using dynamic themeColor
                      let backgroundColor = '#ffffff';
                      if (count > 0) {
                        backgroundColor = `rgba(${themeColor}, ${Math.max(0.15, ratio)})`;
                      }

                      return (
                        <td
                          key={slotKey}
                          onMouseDown={(e) => handleCellMouseDown(slotKey, e)}
                          onMouseEnter={() => handleCellMouseEnter(slotKey)}
                          onMouseLeave={() => setHoveredSlot(null)}
                          style={{ backgroundColor }}
                          className={`h-7 border border-slate-200 cursor-pointer transition-colors relative select-none ${
                            isSelected ? 'ring-2 ring-blue-600 ring-inset z-10' : ''
                          }`}
                        >
                          {isSelected && (
                            <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-blue-600 rounded-full pointer-events-none" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}