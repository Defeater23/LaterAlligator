import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { simulateScenario } from '../api/client';
import RiskBadge from '../components/RiskBadge';
import { ScenarioLineChart } from '../components/Charts';
import {
  canRecover,
  formatPct,
  generatePersonalizedRecommendation,
  maxMissableClasses,
  minClassesToThreshold,
  minRemainingToAttend,
} from '../utils/attendance';

export default function Simulator() {
  const { data, selectedSubjectId, setSelectedSubjectId, selectedSubject, threshold } =
    useApp();

  // Local state for Custom Input and hypothetical scenario
  const [semesterTotal, setSemesterTotal] = useState(48);
  const [attended, setAttended] = useState(29);
  const [missed, setMissed] = useState(7);
  const [simThreshold, setSimThreshold] = useState(threshold ?? 75);
  const [attend, setAttend] = useState(12);
  const [miss, setMiss] = useState(0);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [result, setResult] = useState(null);

  // Populate custom inputs from selected subject when subject or global threshold changes
  useEffect(() => {
    if (!selectedSubject) {
      if (selectedSubjectId === 'custom') {
        setIsCustomMode(true);
      }
      return;
    }
    setIsCustomMode(false);
    const att = Number(selectedSubject.attended) || 0;
    const abs =
      selectedSubject.absent != null
        ? Number(selectedSubject.absent)
        : Math.max(0, (Number(selectedSubject.conducted) || 0) - att);
    const cond = att + abs;
    const semTot =
      selectedSubject.semester_total != null && Number(selectedSubject.semester_total) > 0
        ? Number(selectedSubject.semester_total)
        : cond + (Number(selectedSubject.remaining) || 0);
    const rem = Math.max(0, semTot - cond);

    setSemesterTotal(semTot > 0 ? semTot : (cond > 0 ? cond : 48));
    setAttended(att);
    setMissed(abs);
    setSimThreshold(threshold ?? 75);
    setAttend(rem);
    setMiss(0);
  }, [selectedSubjectId, selectedSubject, threshold]);

  // Handle subject dropdown change
  const onSubjectSelect = (id) => {
    if (id === 'custom') {
      setIsCustomMode(true);
      setSelectedSubjectId('custom');
    } else {
      setIsCustomMode(false);
      setSelectedSubjectId(id);
    }
  };

  // Input validations & parsing
  const isPosIntTotal =
    semesterTotal !== '' &&
    Number.isInteger(Number(semesterTotal)) &&
    Number(semesterTotal) > 0;
  const isNonNegAttended =
    attended !== '' &&
    Number.isInteger(Number(attended)) &&
    Number(attended) >= 0;
  const isNonNegMissed =
    missed !== '' &&
    Number.isInteger(Number(missed)) &&
    Number(missed) >= 0;

  const numSemesterTotal = isPosIntTotal ? Number(semesterTotal) : 0;
  const numAttended = isNonNegAttended ? Number(attended) : 0;
  const numMissed = isNonNegMissed ? Number(missed) : 0;

  // Formula 1: Classes conducted so far = Classes attended + Classes missed.
  const conducted = numAttended + numMissed;

  // Validation errors
  let validationError = null;
  if (!isPosIntTotal) {
    validationError = 'Total semester classes must be a positive integer.';
  } else if (!isNonNegAttended || !isNonNegMissed) {
    validationError = 'Classes attended and missed so far must be non-negative integers.';
  } else if (conducted > numSemesterTotal) {
    validationError = `Classes conducted so far (${conducted} = ${numAttended} attended + ${numMissed} missed) cannot exceed total semester classes (${numSemesterTotal}).`;
  }

  const isValid = validationError === null;

  // Formula 2: Classes remaining = Total semester classes − Classes conducted so far.
  const remaining = isValid ? Math.max(0, numSemesterTotal - conducted) : 0;

  // Formula 3: Current attendance percentage = (Classes attended / Classes conducted so far) × 100.
  const currentPct = conducted > 0 ? (numAttended / conducted) * 100 : null;

  // Handler: Total semester classes change
  const onSemesterTotalChange = (val) => {
    setSemesterTotal(val === '' ? '' : Number(val));
    const parsedTotal = Math.round(Number(val) || 0);
    const cond = numAttended + numMissed;
    const newRemaining = Math.max(0, parsedTotal - cond);

    // Update maximum values of both future attendance sliders and keep them synchronized
    if (newRemaining === 0) {
      setAttend(0);
      setMiss(0);
    } else {
      const newAttend = Math.max(0, Math.min(newRemaining, attend));
      setAttend(newAttend);
      setMiss(newRemaining - newAttend);
    }
  };

  // Handler: Classes attended so far change
  const onAttendedChange = (val) => {
    setAttended(val === '' ? '' : Number(val));
    const parsedAtt = Math.max(0, Math.round(Number(val) || 0));
    const cond = parsedAtt + numMissed;
    const newRemaining = Math.max(0, numSemesterTotal - cond);

    if (newRemaining === 0) {
      setAttend(0);
      setMiss(0);
    } else {
      const newAttend = Math.max(0, Math.min(newRemaining, attend));
      setAttend(newAttend);
      setMiss(newRemaining - newAttend);
    }
  };

  // Handler: Classes missed so far change
  const onMissedChange = (val) => {
    setMissed(val === '' ? '' : Number(val));
    const parsedMiss = Math.max(0, Math.round(Number(val) || 0));
    const cond = numAttended + parsedMiss;
    const newRemaining = Math.max(0, numSemesterTotal - cond);

    if (newRemaining === 0) {
      setAttend(0);
      setMiss(0);
    } else {
      const newAttend = Math.max(0, Math.min(newRemaining, attend));
      setAttend(newAttend);
      setMiss(newRemaining - newAttend);
    }
  };

  // Handler: Future attend slider change
  const onAttendChange = (value) => {
    const x = Math.max(0, Math.min(remaining, Math.round(Number(value) || 0)));
    setAttend(x);
    setMiss(remaining - x);
  };

  // Handler: Future miss slider change
  const onMissChange = (value) => {
    const y = Math.max(0, Math.min(remaining, Math.round(Number(value) || 0)));
    setMiss(y);
    setAttend(remaining - y);
  };

  // Handler: Required attendance threshold slider change
  const onThresholdChange = (val) => {
    const t = Math.max(50, Math.min(95, Math.round(Number(val) || 75)));
    setSimThreshold(t);
  };

  // Formula 4:
  // Projected final attendance percentage =
  // ((Classes attended + Future classes attended) / (Classes conducted so far + Future classes attended + Future classes missed)) × 100.
  const totalFuture = conducted + attend + miss;
  const livePct = useMemo(() => {
    if (!isValid) return 0;
    if (totalFuture === 0) return 0;
    return ((numAttended + attend) / totalFuture) * 100;
  }, [isValid, numAttended, attend, totalFuture]);

  const targetMet = livePct >= simThreshold - 1e-9;
  const margin = livePct - simThreshold;

  // Best possible final attendance (attend 100% of remaining classes)
  const bestPossiblePct = useMemo(() => {
    if (!isValid || numSemesterTotal === 0) return 0;
    return ((numAttended + remaining) / numSemesterTotal) * 100;
  }, [isValid, numAttended, remaining, numSemesterTotal]);

  // Mathematical recovery limits and bounds
  const canRecoverSubject = useMemo(() => {
    if (!isValid || numSemesterTotal === 0) return true;
    return canRecover(numAttended, conducted, remaining, simThreshold);
  }, [isValid, numAttended, conducted, remaining, simThreshold]);

  const minConsecutiveNeeded = useMemo(() => {
    if (!isValid || conducted === 0) return null;
    return minClassesToThreshold(numAttended, conducted, remaining, simThreshold);
  }, [isValid, numAttended, conducted, remaining, simThreshold]);

  const minRemAttend = useMemo(() => {
    if (!isValid) return null;
    return minRemainingToAttend(numAttended, conducted, remaining, simThreshold);
  }, [isValid, numAttended, conducted, remaining, simThreshold]);

  const maxAbsences = useMemo(() => {
    if (!isValid) return null;
    return maxMissableClasses(numAttended, conducted, remaining, simThreshold);
  }, [isValid, numAttended, conducted, remaining, simThreshold]);

  // Personalized dynamic recommendations
  const personalizedRec = useMemo(() => {
    if (!isValid) return null;
    return generatePersonalizedRecommendation(
      numAttended,
      conducted,
      remaining,
      simThreshold,
      numSemesterTotal,
    );
  }, [isValid, numAttended, conducted, remaining, simThreshold, numSemesterTotal]);

  // Track if custom inputs differ from selected subject's original data
  const isOverridden = useMemo(() => {
    if (!selectedSubject || isCustomMode) return false;
    const origAtt = Number(selectedSubject.attended) || 0;
    const origAbs =
      selectedSubject.absent != null
        ? Number(selectedSubject.absent)
        : Math.max(0, (Number(selectedSubject.conducted) || 0) - origAtt);
    const origCond = origAtt + origAbs;
    const origTot =
      selectedSubject.semester_total != null && Number(selectedSubject.semester_total) > 0
        ? Number(selectedSubject.semester_total)
        : origCond + (Number(selectedSubject.remaining) || 0);

    return (
      Number(semesterTotal) !== origTot ||
      Number(attended) !== origAtt ||
      Number(missed) !== origAbs
    );
  }, [selectedSubject, isCustomMode, semesterTotal, attended, missed]);

  // Reset local overrides to original subject data
  const resetToSubjectData = () => {
    if (!selectedSubject) return;
    const origAtt = Number(selectedSubject.attended) || 0;
    const origAbs =
      selectedSubject.absent != null
        ? Number(selectedSubject.absent)
        : Math.max(0, (Number(selectedSubject.conducted) || 0) - origAtt);
    const origCond = origAtt + origAbs;
    const origTot =
      selectedSubject.semester_total != null && Number(selectedSubject.semester_total) > 0
        ? Number(selectedSubject.semester_total)
        : origCond + (Number(selectedSubject.remaining) || 0);
    const rem = Math.max(0, origTot - origCond);

    setSemesterTotal(origTot > 0 ? origTot : (origCond > 0 ? origCond : 48));
    setAttended(origAtt);
    setMissed(origAbs);
    setAttend(rem);
    setMiss(0);
  };

  // Recalculate simulation scenarios live when any input changes
  useEffect(() => {
    if (!isValid) {
      setResult(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const payload = await simulateScenario({
        attended: numAttended,
        conducted: conducted,
        percentage: currentPct != null ? Number(currentPct.toFixed(2)) : null,
        remaining,
        threshold: simThreshold,
        attend,
        miss,
        semester_total: numSemesterTotal,
      });
      if (!cancelled) {
        setResult(payload);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isValid, numAttended, conducted, currentPct, remaining, simThreshold, attend, miss, numSemesterTotal]);

  const baselineRisk = selectedSubject?.prediction?.risk ?? 'Low';

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>What-If Simulator</h1>
          <p>
            Experiment with upcoming class attendance and instantly see the projected impact on your final compliance.
          </p>
        </div>
        <div className="badge-row">
          {conducted > 0 && <RiskBadge risk={baselineRisk} />}
          {isCustomMode && <span className="badge info">Custom Mode</span>}
          {isOverridden && <span className="badge warning">Hypothetical Scenario</span>}
        </div>
      </div>

      {/* Simulator Reference Container with Dark Background, White Text, Green Success Indicators */}
      <div
        className="card simulator-reference-card"
        style={{
          background: 'linear-gradient(180deg, #132a45 0%, #1e3a5f 100%)',
          color: '#ffffff',
          borderRadius: 'var(--radius)',
          padding: '1.75rem 2rem',
          boxShadow: '0 8px 30px rgba(19, 42, 69, 0.22)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          marginBottom: '1.5rem',
        }}
      >
        {/* Subject Selection Bar */}
        <div
          style={{
            marginBottom: '1.25rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div style={{ flex: '1', minWidth: '260px' }}>
            <label
              htmlFor="sim-subject"
              style={{
                display: 'block',
                fontSize: '0.82rem',
                fontWeight: 600,
                color: 'rgba(255, 255, 255, 0.85)',
                marginBottom: '0.4rem',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Select Subject
            </label>
            <select
              id="sim-subject"
              value={isCustomMode ? 'custom' : selectedSubjectId}
              onChange={(e) => onSubjectSelect(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 0.85rem',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.12)',
                color: '#ffffff',
                border: '1px solid rgba(255, 255, 255, 0.22)',
                outline: 'none',
                fontSize: '0.95rem',
              }}
            >
              {data?.subjects?.map((s) => (
                <option key={s.id} value={s.id} style={{ background: '#132a45', color: '#ffffff' }}>
                  {s.code}: {s.name}{' '}
                  {s.conducted > 0
                    ? `(${s.displayed_attendance || Math.round((s.attended / s.conducted) * 100) + '%'})`
                    : '— No attendance recorded'}
                </option>
              ))}
              <option value="custom" style={{ background: '#132a45', color: '#ffffff' }}>
                Custom / Manual Attendance Input
              </option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginTop: '1.2rem', flexWrap: 'wrap' }}>
            {isValid && (
              <span
                style={{
                  background: 'rgba(255, 255, 255, 0.14)',
                  color: '#ffffff',
                  padding: '0.35rem 0.85rem',
                  borderRadius: '999px',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  border: '1px solid rgba(255, 255, 255, 0.18)',
                }}
              >
                {numAttended} Attended · {numMissed} Missed · {conducted} Conducted · {numSemesterTotal} Semester Total ({remaining} Remaining)
              </span>
            )}
            {isOverridden && (
              <button
                type="button"
                onClick={resetToSubjectData}
                style={{
                  background: 'rgba(255, 255, 255, 0.14)',
                  border: '1px solid rgba(255, 255, 255, 0.25)',
                  color: '#ffffff',
                  borderRadius: '999px',
                  padding: '0.35rem 0.8rem',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                }}
                title="Reset custom inputs back to original subject attendance records"
              >
                ↺ Reset to Subject
              </button>
            )}
          </div>
        </div>

        {/* Custom Input Section with Total Semester Classes, Attended So Far, Missed So Far */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
            marginBottom: '1.25rem',
            padding: '1rem 1.25rem',
            background: 'rgba(255, 255, 255, 0.08)',
            borderRadius: '10px',
            border: '1px solid rgba(255, 255, 255, 0.15)',
          }}
        >
          <div>
            <label
              htmlFor="sim-semester-total"
              style={{
                display: 'block',
                fontSize: '0.8rem',
                color: 'rgba(255, 255, 255, 0.85)',
                marginBottom: '0.35rem',
                fontWeight: 600,
              }}
            >
              Total Semester Classes (Planned)
            </label>
            <input
              id="sim-semester-total"
              type="number"
              min={1}
              step={1}
              value={semesterTotal}
              onChange={(e) => onSemesterTotalChange(e.target.value)}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.15)',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                color: '#ffffff',
                fontSize: '0.95rem',
                fontWeight: 600,
              }}
              aria-label="Total number of classes planned for the entire semester"
            />
            <div style={{ fontSize: '0.72rem', color: 'rgba(255, 255, 255, 0.65)', marginTop: '0.25rem' }}>
              Classes planned for entire semester
            </div>
          </div>

          <div>
            <label
              htmlFor="sim-attended"
              style={{
                display: 'block',
                fontSize: '0.8rem',
                color: 'rgba(255, 255, 255, 0.85)',
                marginBottom: '0.35rem',
                fontWeight: 600,
              }}
            >
              Classes Attended So Far
            </label>
            <input
              id="sim-attended"
              type="number"
              min={0}
              step={1}
              value={attended}
              onChange={(e) => onAttendedChange(e.target.value)}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.15)',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                color: '#ffffff',
                fontSize: '0.95rem',
                fontWeight: 600,
              }}
              aria-label="Classes attended so far"
            />
            <div style={{ fontSize: '0.72rem', color: 'rgba(255, 255, 255, 0.65)', marginTop: '0.25rem' }}>
              Sessions attended to date
            </div>
          </div>

          <div>
            <label
              htmlFor="sim-missed"
              style={{
                display: 'block',
                fontSize: '0.8rem',
                color: 'rgba(255, 255, 255, 0.85)',
                marginBottom: '0.35rem',
                fontWeight: 600,
              }}
            >
              Classes Missed So Far
            </label>
            <input
              id="sim-missed"
              type="number"
              min={0}
              step={1}
              value={missed}
              onChange={(e) => onMissedChange(e.target.value)}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.15)',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                color: '#ffffff',
                fontSize: '0.95rem',
                fontWeight: 600,
              }}
              aria-label="Classes missed so far"
            />
            <div style={{ fontSize: '0.72rem', color: 'rgba(255, 255, 255, 0.65)', marginTop: '0.25rem' }}>
              Sessions missed to date
            </div>
          </div>
        </div>

        {/* Validation Error Message Alert */}
        {validationError && (
          <div
            style={{
              padding: '1rem 1.25rem',
              borderRadius: '10px',
              background: 'rgba(239, 68, 68, 0.22)',
              border: '1.5px solid #ef4444',
              color: '#fca5a5',
              marginBottom: '1.25rem',
              fontSize: '0.92rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
            }}
          >
            <span style={{ fontSize: '1.4rem' }}>⚠️</span>
            <div>
              <strong>Validation Error:</strong> {validationError}
            </div>
          </div>
        )}

        {/* Main Simulator Content (rendered when valid) */}
        {isValid && (
          <>
            {/* 1. Top Section: Current Attendance and Remaining Classes in Two Columns */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '2rem',
                alignItems: 'start',
              }}
            >
              {/* Column 1: Current Attendance */}
              <div>
                <div
                  style={{
                    fontSize: '0.82rem',
                    color: 'rgba(255, 255, 255, 0.7)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    fontWeight: 600,
                  }}
                >
                  Current Attendance
                </div>
                {conducted > 0 ? (
                  <>
                    <div
                      style={{
                        fontSize: '2.5rem',
                        fontWeight: 800,
                        color: '#ffffff',
                        margin: '0.2rem 0',
                        lineHeight: 1.1,
                      }}
                    >
                      {currentPct != null ? `${currentPct.toFixed(1)}%` : '—'}
                      {currentPct != null && (
                        <span
                          style={{
                            fontSize: '1.15rem',
                            fontWeight: 500,
                            color: 'rgba(255, 255, 255, 0.7)',
                            marginLeft: '0.6rem',
                          }}
                        >
                          ({Math.round(currentPct)}%)
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.8)' }}>
                      {numAttended} of {conducted} classes attended ({numMissed} missed)
                    </div>
                  </>
                ) : (
                  <>
                    <div
                      style={{
                        fontSize: '2.2rem',
                        fontWeight: 800,
                        color: '#ffffff',
                        margin: '0.2rem 0',
                        lineHeight: 1.1,
                      }}
                    >
                      Unavailable
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.8)' }}>
                      No classes conducted yet (0 attended · 0 missed)
                    </div>
                  </>
                )}
              </div>

              {/* Column 2: Remaining Classes in Semester (R) */}
              <div>
                <div
                  style={{
                    fontSize: '0.82rem',
                    color: 'rgba(255, 255, 255, 0.7)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    fontWeight: 600,
                  }}
                >
                  Remaining Classes in Semester (R)
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.2rem' }}>
                  <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#ffffff', lineHeight: 1.1 }}>
                    {remaining}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.85)', fontWeight: 500 }}>
                      {conducted} conducted of {numSemesterTotal} total semester classes
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'rgba(255, 255, 255, 0.6)', marginTop: '0.15rem' }}>
                      Calculated from semester total − conducted
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Divider Separating Summary from Scenario Controls */}
            <div
              style={{
                borderTop: '1px solid rgba(255, 255, 255, 0.18)',
                margin: '1.4rem 0',
              }}
            />

            {/* 3. Scenario Controls (Sliders) */}
            <div style={{ display: 'grid', gap: '1.25rem' }}>
              {/* Slider 1: Expected to Attend */}
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.35rem',
                  }}
                >
                  <label htmlFor="attend-slider" style={{ fontSize: '0.9rem', fontWeight: 600, color: '#ffffff' }}>
                    Upcoming classes you expect to attend
                  </label>
                  <span style={{ fontSize: '1.05rem', fontWeight: 700, color: remaining === 0 ? 'rgba(255, 255, 255, 0.6)' : '#4ade80' }}>
                    {attend} classes
                  </span>
                </div>
                <input
                  id="attend-slider"
                  type="range"
                  min={0}
                  max={Math.max(1, remaining)}
                  value={attend}
                  disabled={remaining === 0}
                  onChange={(e) => onAttendChange(e.target.value)}
                  style={{
                    width: '100%',
                    accentColor: '#22c55e',
                    height: '6px',
                    cursor: remaining === 0 ? 'not-allowed' : 'pointer',
                    opacity: remaining === 0 ? 0.45 : 1,
                  }}
                />
              </div>

              {/* Slider 2: Expected to Miss */}
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.35rem',
                  }}
                >
                  <label htmlFor="miss-slider" style={{ fontSize: '0.9rem', fontWeight: 600, color: '#ffffff' }}>
                    Upcoming classes you expect to miss
                  </label>
                  <span
                    style={{
                      fontSize: '1.05rem',
                      fontWeight: 700,
                      color:
                        remaining === 0
                          ? 'rgba(255, 255, 255, 0.6)'
                          : miss > 0
                            ? '#f87171'
                            : 'rgba(255, 255, 255, 0.85)',
                    }}
                  >
                    {miss} classes
                  </span>
                </div>
                <input
                  id="miss-slider"
                  type="range"
                  min={0}
                  max={Math.max(1, remaining)}
                  value={miss}
                  disabled={remaining === 0}
                  onChange={(e) => onMissChange(e.target.value)}
                  style={{
                    width: '100%',
                    accentColor: '#ef4444',
                    height: '6px',
                    cursor: remaining === 0 ? 'not-allowed' : 'pointer',
                    opacity: remaining === 0 ? 0.45 : 1,
                  }}
                />
                <div style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.7)', marginTop: '0.3rem' }}>
                  {remaining === 0
                    ? 'Semester schedule completed (0 remaining classes). Future attendance controls are disabled.'
                    : `Synchronized plan: ${attend} attended + ${miss} missed = ${remaining} remaining classes`}
                </div>
              </div>

              {/* Slider 3: Required Attendance Threshold */}
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.35rem',
                  }}
                >
                  <label htmlFor="threshold-slider" style={{ fontSize: '0.9rem', fontWeight: 600, color: '#ffffff' }}>
                    Required attendance threshold
                  </label>
                  <span style={{ fontSize: '1.05rem', fontWeight: 700, color: '#60a5fa' }}>
                    {simThreshold}%
                  </span>
                </div>
                <input
                  id="threshold-slider"
                  type="range"
                  min={50}
                  max={95}
                  step={1}
                  value={simThreshold}
                  onChange={(e) => onThresholdChange(e.target.value)}
                  style={{
                    width: '100%',
                    accentColor: '#3b82f6',
                    height: '6px',
                    cursor: 'pointer',
                  }}
                />
              </div>
            </div>

            {/* 4. Divider Separating Controls from Bottom Projection */}
            <div
              style={{
                borderTop: '1px solid rgba(255, 255, 255, 0.18)',
                margin: '1.4rem 0',
              }}
            />

            {/* 5. Projected Final Attendance & Clear Status Indicator */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '1.5rem',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: '0.82rem',
                    color: 'rgba(255, 255, 255, 0.7)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    fontWeight: 600,
                  }}
                >
                  Projected Final Attendance
                </div>
                {conducted === 0 && remaining === 0 ? (
                  <div
                    style={{
                      fontSize: '2.5rem',
                      fontWeight: 800,
                      color: '#ffffff',
                      lineHeight: 1.1,
                      margin: '0.25rem 0',
                    }}
                  >
                    Unavailable
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        fontSize: '3.1rem',
                        fontWeight: 800,
                        color: '#ffffff',
                        lineHeight: 1.1,
                        margin: '0.25rem 0',
                      }}
                    >
                      {livePct.toFixed(1)}%
                      <span
                        style={{
                          fontSize: '1.3rem',
                          fontWeight: 600,
                          color: 'rgba(255, 255, 255, 0.75)',
                          marginLeft: '0.65rem',
                        }}
                      >
                        ({Math.round(livePct)}%)
                      </span>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.8)' }}>
                      {remaining === 0
                        ? `Final counts: ${numAttended} attended / ${conducted} conducted (all classes concluded)`
                        : `New totals: ${numAttended + attend} attended / ${conducted + attend + miss} conducted (${numSemesterTotal} semester total)`}
                    </div>
                  </>
                )}
              </div>

              {/* Status Indicator */}
              <div style={{ textAlign: 'right' }}>
                {targetMet ? (
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      background: 'rgba(34, 197, 94, 0.22)',
                      border: '1.5px solid #22c55e',
                      color: '#4ade80',
                      padding: '0.65rem 1.35rem',
                      borderRadius: '999px',
                      fontSize: '1.05rem',
                      fontWeight: 700,
                    }}
                  >
                    ✓ Target Met (+{margin.toFixed(1)}% buffer)
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      background: 'rgba(239, 68, 68, 0.22)',
                      border: '1.5px solid #ef4444',
                      color: '#f87171',
                      padding: '0.65rem 1.35rem',
                      borderRadius: '999px',
                      fontSize: '1.05rem',
                      fontWeight: 700,
                    }}
                  >
                    ⚠ Below Target ({margin.toFixed(1)}%)
                  </div>
                )}
                <div style={{ fontSize: '0.82rem', color: 'rgba(255, 255, 255, 0.75)', marginTop: '0.45rem' }}>
                  Target: <strong>{simThreshold}%</strong>
                </div>
              </div>
            </div>

            {/* Mathematical Recovery Limits & Best Possible Attendance */}
            <div
              style={{
                marginTop: '1.25rem',
                padding: '0.85rem 1.1rem',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                fontSize: '0.86rem',
                display: 'flex',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.8rem',
                color: 'rgba(255, 255, 255, 0.92)',
              }}
            >
              <div>
                <strong>Best possible final:</strong> {bestPossiblePct.toFixed(1)}% (if all {remaining} remaining attended)
              </div>
              <div>
                <strong>Recovery status:</strong>{' '}
                {canRecoverSubject ? (
                  <span style={{ color: '#4ade80', fontWeight: 600 }}>
                    {currentPct != null && currentPct >= simThreshold
                      ? `Maintained above threshold (can miss up to ${maxAbsences ?? 0} of ${remaining} remaining classes)`
                      : `Mathematically possible (attend at least ${minRemAttend ?? minConsecutiveNeeded ?? 0} of ${remaining} classes, max ${maxAbsences ?? 0} absences)`}
                  </span>
                ) : (
                  <span style={{ color: '#f87171', fontWeight: 700 }}>
                    ⚠️ Mathematically unrecoverable within {remaining} remaining classes
                  </span>
                )}
              </div>
              {!canRecoverSubject && remaining > 0 && (
                <div style={{ width: '100%', color: '#fca5a5', fontSize: '0.84rem' }}>
                  Attending every remaining class ({remaining}) will achieve at most {bestPossiblePct.toFixed(1)}%, which cannot meet the required {simThreshold}% threshold.
                </div>
              )}
              {personalizedRec?.recommendation && (
                <div
                  style={{
                    width: '100%',
                    marginTop: '0.45rem',
                    color: 'rgba(255, 255, 255, 0.9)',
                    fontSize: '0.85rem',
                    borderTop: '1px solid rgba(255, 255, 255, 0.12)',
                    paddingTop: '0.45rem',
                  }}
                >
                  <strong>Recommendation:</strong> {personalizedRec.recommendation}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Scenarios Comparison Table (Active only when valid) */}
      {isValid && result?.scenario_comparison && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h2>Future attendance scenarios comparison</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Scenario Plan</th>
                  <th>Attend (X)</th>
                  <th>Miss (Y)</th>
                  <th>Projected %</th>
                  <th>Threshold Status</th>
                  <th>Margin</th>
                </tr>
              </thead>
              <tbody>
                {result.scenario_comparison.map((sc) => {
                  const isSelected = sc.id === 'C';
                  return (
                    <tr
                      key={sc.id}
                      style={
                        isSelected
                          ? { background: 'var(--bg-soft)', fontWeight: 600 }
                          : undefined
                      }
                    >
                      <td>
                        <div>
                          {sc.name}{' '}
                          {isSelected && (
                            <span
                              className="badge info"
                              style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem' }}
                            >
                              Active Setting
                            </span>
                          )}
                        </div>
                        <div className="muted" style={{ fontSize: '0.75rem' }}>
                          {sc.description}
                        </div>
                      </td>
                      <td>{sc.attend}</td>
                      <td>{sc.miss}</td>
                      <td>{formatPct(sc.projected)}</td>
                      <td>
                        {sc.meets_threshold ? (
                          <span className="badge low">Compliant</span>
                        ) : (
                          <span className="badge high">Non-Compliant</span>
                        )}
                      </td>
                      <td
                        style={{
                          color: sc.margin >= 0 ? 'var(--risk-low)' : 'var(--risk-high)',
                          fontWeight: 600,
                        }}
                      >
                        {sc.margin >= 0 ? `+${sc.margin.toFixed(1)}%` : `${sc.margin.toFixed(1)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Scenario Line Chart (Active only when valid) */}
      {isValid && result?.scenario_chart && (
        <div className="card">
          <h2>How projected % changes if you miss more remaining classes</h2>
          <ScenarioLineChart
            chart={result.scenario_chart}
            threshold={simThreshold}
            highlight={miss}
          />
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
            Each point assumes the remaining undecided classes are attended. Your current slider setting (miss = {miss}) is marked when available.
          </p>
        </div>
      )}
    </div>
  );
}
