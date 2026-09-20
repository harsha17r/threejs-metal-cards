import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './garden.css';

const GardenApp = lazy(() => import('./GardenApp.jsx'));

function BootShell() {
  return (
    <div className="garden-boot-shell" role="status" aria-label="Loading card collection">
      <div className="garden-boot-wave" aria-hidden="true">
        {Array.from({ length: 7 }, (_, index) => <span key={index} />)}
      </div>
      <div className="garden-boot-progress" aria-hidden="true">&nbsp;&nbsp;0%</div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <Suspense fallback={<BootShell />}>
    <GardenApp />
  </Suspense>,
);
