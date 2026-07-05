import React from 'react';

export function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="panel">
      <h1>{title}</h1>
      <p className="muted">{note}</p>
      <p className="muted small">See PLAN.md for the full design of this area.</p>
    </div>
  );
}
