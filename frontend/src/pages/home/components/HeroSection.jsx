import React from "react";
import { Link } from "react-router-dom";
import HeroBackground from "./HeroBackground";
import HeroVisual from "./HeroVisual";

const HeroSection = ({ text, appName }) => (
  <div className="hero-shell">
    <section className="hero">
      <HeroBackground />

      <div className="hero-grid">
        <div className="hero-left">
          <div className="eyebrow">
            <span className="dot" />
            <span>Live · Government of Fiji</span>
            <span className="sep" />
            <span>
              Department of <em>Water &amp; Sewerage</em>
            </span>
          </div>

          <h1 className="hero-title">
            {text.homeJumbotronTitle} — a comprehensive platform for{" "}
            <span className="accent">water &amp; sewerage</span> services in
            Fiji.
          </h1>

          <p className="hero-sub">{text.homeJumbotronSubtitle}</p>

          <div className="cta-row">
            <Link to="/login">
              <button type="button" className="btn-cta">
                Log in to {appName}
                <span className="arrow" aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M5 12h14M13 5l7 7-7 7"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </button>
            </Link>
            <a href="#mandate">
              <button type="button" className="btn-secondary">
                <span className="play" aria-hidden="true">
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
                Learn about our mandate
              </button>
            </a>
          </div>
        </div>

        <HeroVisual
          image={text.homeJumbotronImage}
          captionEyebrow={`${appName} Platform`}
          captionTitle={
            <>
              Safe, reliable water
              <br />
              for every community in Fiji.
            </>
          }
        />
      </div>
    </section>
  </div>
);

export default HeroSection;
