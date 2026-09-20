import { motion, useReducedMotion } from 'motion/react';
import { TextMorph } from 'torph/react';
import './pulsating-loader.css';

const BARS = Array.from({ length: 7 });

export default function PulsatingLoader({ progress = 0 }) {
  const reduceMotion = useReducedMotion();
  const digits = String(Math.max(0, Math.min(100, Math.round(progress))))
    .padStart(3, ' ')
    .split(' ')
    .join('\u00a0')
    .split('');

  return (
    <div className="pulsating-loader">
      <div className="pulsating-loader__wave" aria-hidden="true">
        {BARS.map((_, index) => (
          <motion.span
            className="pulsating-loader__bar"
            key={index}
            animate={reduceMotion
              ? { opacity: [0.42, 1, 0.42] }
              : {
                  transform: [
                    'translateY(0%) scaleX(1) scaleY(.5)',
                    'translateY(-15%) scaleX(.8) scaleY(1.5)',
                    'translateY(0%) scaleX(1) scaleY(.5)',
                  ],
                  opacity: [0.46, 1, 0.46],
                }}
            transition={{
              duration: 1,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: index * 0.1,
            }}
          />
        ))}
      </div>
      <div className="pulsating-loader__progress-frame" aria-hidden="true">
        {digits.map((digit, index) => (
          <span className="pulsating-loader__digit-slot" key={index}>
            <TextMorph
              as="span"
              className="pulsating-loader__progress"
              duration={120}
              ease="cubic-bezier(0.19, 1, 0.22, 1)"
              numbers
              scale={false}
            >
              {digit}
            </TextMorph>
          </span>
        ))}
        <span className="pulsating-loader__percent">%</span>
      </div>
    </div>
  );
}
