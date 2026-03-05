'use client';

import { useState, useEffect } from 'react';
import FloatingAddButton from './FloatingAddButton';
import MobileQuickAddPanel from './MobileQuickAddPanel';

export default function MobileQuickAddWrapper() {
  const [isOpen, setIsOpen] = useState(false);
  const [trips, setTrips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch active trips for the quick add panel
    async function fetchTrips() {
      try {
        const res = await fetch('/api/dispatch/trips');
        if (res.ok) {
          const data = await res.json();
          // Filter to Active/Not Started trips
          const activeTrips = Array.isArray(data) 
            ? data.filter((t: any) => t.status === 'Active' || t.status === 'Not Started')
            : [];
          setTrips(activeTrips);
        }
      } catch (err) {
        console.error('Failed to fetch trips:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchTrips();
  }, []);

  if (loading) {
    return null;
  }

  return (
    <>
      <FloatingAddButton onClick={() => setIsOpen(true)} />
      <MobileQuickAddPanel
        trips={trips}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}
