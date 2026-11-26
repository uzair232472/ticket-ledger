import React, { useEffect, useState } from 'react';
import { CrowdInsightPanel, useInsight } from '../ml/InsightPanels';
import CrowdFlowChart from './CrowdFlowChart';
import CrowdHall3D from './CrowdHall3D';
import { busiestSlot, minutesOf } from '../../lib/crowdFlow';

/*
 * Crowd flow on the Live tab: the "Expected arrivals per gate" panel (with the crowd-flow chart) and the 3D view.
 * Loads the crowd insight ONCE and shares it, with one selection (time slot, source, gate): clicking a slot in the
 * chart moves the 3D slider and seat colours, and moving the slider moves the chart's selection.
 */
export default function CrowdFlowSection({ eventId }) {
  const loaded = useInsight(eventId ? `/ml/insights/events/${eventId}/crowd` : null);
  const data = loaded.data;
  const [slot, setSlot] = useState(null);
  const [source, setSource] = useState('rule');
  const [gateId, setGateId] = useState(null);

  // New event: clear the selection; first data: select the busiest slot (as the 3D view did on its own)
  useEffect(() => { setSlot(null); setGateId(null); setSource('rule'); }, [eventId]);
  useEffect(() => {
    if (!data || slot !== null) return;
    const m = busiestSlot(data, 'rule') ?? minutesOf(data)[0] ?? null;
    if (m !== null) setSlot(m);
  }, [data, slot]);

  if (loaded.loading) return null;
  return (
    <>
      {data && (
        <CrowdInsightPanel
          eventId={eventId}
          data={data}
          chart={slot !== null && (
            <CrowdFlowChart data={data} slot={slot} onSlot={setSlot} source={source} onSource={setSource} gateId={gateId} onGate={setGateId} />
          )}
        />
      )}
      <CrowdHall3D eventId={eventId} crowd={data ?? null} slot={slot} onSlot={setSlot} source={source} onSource={setSource} />
    </>
  );
}
