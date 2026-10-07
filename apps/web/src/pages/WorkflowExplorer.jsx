import React, { useEffect, useMemo, useRef } from 'react';
import HomeHeader from '../components/home/HomeHeader';
import { buildWorkflowData } from '../components/workflow/flowData';
import { mountWorkflow } from '../components/workflow/workflowEngine';
import '../components/home/home.css';
import '../components/workflow/workflow.css';

/** Controls, stage and status of the workflow explorer; the engine finds them by their data-fc names. */
export function WorkflowMarkup({ moduleCount }) {
  return (
    <>
      <div className="wf-heading">
        <div className="wf-heading-copy">
          <p className="tl-eyebrow wf-eyebrow"><span>Workflow explorer</span><span className="wf-count">{moduleCount} modules</span></p>
          <div className="wf-title-row">
            <h1 className="wf-title" data-fc="title" tabIndex={-1}>Overall flow</h1>
            <span className="wf-status-pill" data-fc="status" hidden />
          </div>
          <p className="wf-basis" data-fc="basis" />
        </div>
        <label className="wf-picker">
          <span>Module / workflow</span>
          <select data-fc="select" aria-label="Choose a module or workflow" />
        </label>
      </div>

      <div className="wf-nav">
        <div className="wf-path">
          <button className="wf-btn wf-back" data-fc="back" type="button" aria-label="Back to previous flow">← <span>Back</span></button>
          <nav className="wf-crumbs" data-fc="crumbs" aria-label="Workflow path" />
        </div>
        <div className="wf-controls">
          <button className="wf-btn wf-btn--green" data-fc="play" type="button">Pause</button>
          <button className="wf-btn" data-fc="step" type="button">Next step →</button>
        </div>
      </div>

      <section className="wf-stage" aria-label="Interactive flowchart canvas">
        <svg className="wf-canvas" data-fc="svg" role="img" aria-label="Workflow diagram" preserveAspectRatio="xMidYMid meet" />
        <p className="wf-hint">Click a module to open its flow · Drag to pan · Pinch or scroll to zoom</p>
        <div className="wf-zoom" aria-label="Diagram zoom controls">
          <button data-fc="zoom-out" type="button" aria-label="Zoom out">−</button>
          <output data-fc="zoom-level" aria-live="off">100%</output>
          <button data-fc="zoom-in" type="button" aria-label="Zoom in">+</button>
          <button data-fc="fit" type="button" title="Fit the entire flow to the screen">Fit</button>
        </div>
      </section>

      <footer className="wf-status">
        <div>
          <div className="wf-status-line"><span className="wf-position" data-fc="position" /><span className="wf-current" data-fc="current" /></div>
          <p className="wf-detail" data-fc="detail" />
        </div>
        <div className="wf-legend">
          <span><i className="wf-dot" />Current step</span>
          <span data-fc="branch-legend">┄ Related / optional</span>
          <span>↗ Open module</span>
        </div>
      </footer>
      <span className="wf-sr" data-fc="live" aria-live="polite" />
    </>
  );
}

/**
 * Workflow explorer: the overall flow through every module, and each module's animated flowchart, inside the
 * app's Home-page design (site header, night-green stage, green controls). Data comes from flowData.js.
 */
export default function WorkflowExplorer() {
  const rootRef = useRef(null);
  const data = useMemo(() => buildWorkflowData(), []);

  useEffect(() => {
    const destroy = mountWorkflow(rootRef.current, data);
    return destroy;
  }, [data]);

  return (
    <div className="tl-home tl-wf">
      <HomeHeader tone="dark" />
      <main ref={rootRef} className="wf-app" aria-label="TicketLedger workflow explorer">
        <WorkflowMarkup moduleCount={data.moduleCount} />
      </main>
    </div>
  );
}
