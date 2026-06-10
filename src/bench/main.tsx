import React from 'react';
import ReactDOM from 'react-dom/client';
import { SandboxBench } from './SandboxBench';
import './bench.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SandboxBench />
  </React.StrictMode>,
);
