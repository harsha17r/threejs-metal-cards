import React from 'react';
import { createRoot } from 'react-dom/client';
import GardenApp from './GardenApp.jsx';
import './styles.css';
import './garden.css';

createRoot(document.getElementById('root')).render(<GardenApp />);
