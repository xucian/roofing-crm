import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { StartupError } from './app/StartupError';
import { loadRuntimeConfig } from './config/runtime-config';

const container = document.getElementById('root');
if (!container) throw new Error('index.html has no #root element');
const root = createRoot(container);

loadRuntimeConfig()
  .then((config) => {
    root.render(
      <StrictMode>
        <App config={config} />
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    root.render(<StartupError error={error} />);
  });
