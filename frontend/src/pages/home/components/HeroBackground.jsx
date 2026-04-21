import React from "react";

const HeroBackground = () => (
  <div className="hero-bg" aria-hidden="true">
    <div className="hero-grid-lines" />
    <div className="glow glow-c" />
    <div className="glow glow-a" />
    <div className="glow glow-b" />
    <div className="waves">
      <svg viewBox="0 0 1440 420" preserveAspectRatio="none">
        <defs>
          <linearGradient id="wA" x1="0" y1="0" x2="1" y2="0">
            <stop
              offset="0%"
              stopColor="oklch(0.78 0.11 195)"
              stopOpacity="0"
            />
            <stop
              offset="50%"
              stopColor="oklch(0.78 0.11 195)"
              stopOpacity=".35"
            />
            <stop
              offset="100%"
              stopColor="oklch(0.78 0.11 195)"
              stopOpacity="0"
            />
          </linearGradient>
          <linearGradient id="wB" x1="0" y1="0" x2="1" y2="0">
            <stop
              offset="0%"
              stopColor="oklch(0.55 0.14 230)"
              stopOpacity="0"
            />
            <stop
              offset="50%"
              stopColor="oklch(0.55 0.14 230)"
              stopOpacity=".55"
            />
            <stop
              offset="100%"
              stopColor="oklch(0.55 0.14 230)"
              stopOpacity="0"
            />
          </linearGradient>
          <linearGradient id="wC" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="oklch(0.28 0.08 235)"
              stopOpacity=".9"
            />
            <stop
              offset="100%"
              stopColor="oklch(0.2 0.05 245)"
              stopOpacity="1"
            />
          </linearGradient>
        </defs>
        <path
          d="M0 240 C 180 200, 360 300, 560 250 S 920 180, 1120 230 1440 220 1440 240 0 240 0 240Z"
          fill="none"
          stroke="url(#wA)"
          strokeWidth="1.2"
        >
          <animate
            attributeName="d"
            dur="14s"
            repeatCount="indefinite"
            values="M0 240 C 180 200, 360 300, 560 250 S 920 180, 1120 230 1440 220 1440 240 0 240 0 240Z;
              M0 240 C 180 270, 360 210, 560 280 S 920 250, 1120 190 1440 240 1440 240 0 240 0 240Z;
              M0 240 C 180 200, 360 300, 560 250 S 920 180, 1120 230 1440 220 1440 240 0 240 0 240Z"
          />
        </path>
        <path
          d="M0 300 C 220 260, 420 340, 640 300 S 1000 260, 1220 310 1440 290 1440 300 0 300 0 300Z"
          fill="none"
          stroke="url(#wB)"
          strokeWidth="1.5"
        >
          <animate
            attributeName="d"
            dur="11s"
            repeatCount="indefinite"
            values="M0 300 C 220 260, 420 340, 640 300 S 1000 260, 1220 310 1440 290 1440 300 0 300 0 300Z;
              M0 300 C 220 330, 420 260, 640 340 S 1000 320, 1220 260 1440 320 1440 300 0 300 0 300Z;
              M0 300 C 220 260, 420 340, 640 300 S 1000 260, 1220 310 1440 290 1440 300 0 300 0 300Z"
          />
        </path>
        <path
          d="M0 360 C 200 320, 420 400, 700 360 S 1100 320, 1440 370 L 1440 420 L 0 420 Z"
          fill="url(#wC)"
          opacity=".85"
        >
          <animate
            attributeName="d"
            dur="9s"
            repeatCount="indefinite"
            values="M0 360 C 200 320, 420 400, 700 360 S 1100 320, 1440 370 L 1440 420 L 0 420 Z;
              M0 360 C 200 390, 420 330, 700 400 S 1100 360, 1440 330 L 1440 420 L 0 420 Z;
              M0 360 C 200 320, 420 400, 700 360 S 1100 320, 1440 370 L 1440 420 L 0 420 Z"
          />
        </path>
      </svg>
    </div>
  </div>
);

export default HeroBackground;
