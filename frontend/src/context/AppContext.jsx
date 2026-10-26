import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { loadStudentDashboard } from '../api/client';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [threshold, setThreshold] = useState(75);
  const [selectedSubjectId, setSelectedSubjectId] = useState('ds');
  const [error, setError] = useState(null);

  const refresh = useCallback(async (nextThreshold) => {
    setLoading(true);
    setError(null);
    try {
      const t = nextThreshold ?? threshold;
      const payload = await loadStudentDashboard(t);
      setData(payload);
      setThreshold(payload.student.threshold);
      setSelectedSubjectId((prev) => {
        if (payload.subjects.some((s) => s.id === prev)) return prev;
        return payload.subjects[0]?.id ?? null;
      });
    } catch (err) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [threshold]);

  useEffect(() => {
    refresh(75);
    // Initial load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedSubject = useMemo(
    () => data?.subjects?.find((s) => s.id === selectedSubjectId) ?? null,
    [data, selectedSubjectId],
  );

  const updateThreshold = async (value) => {
    const next = Number(value);
    setThreshold(next);
    await refresh(next);
  };

  const value = {
    data,
    loading,
    error,
    threshold,
    selectedSubjectId,
    selectedSubject,
    setSelectedSubjectId,
    updateThreshold,
    refresh,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
