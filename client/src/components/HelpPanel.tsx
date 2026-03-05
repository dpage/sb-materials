import React, { useEffect, useRef } from 'react';
import { useHelp } from './HelpContext';
import { helpTopics } from './HelpContent';

export function HelpPanel() {
  const { isOpen, topic, close } = useHelp();
  const bodyRef = useRef<HTMLDivElement>(null);

  const content = helpTopics[topic] || helpTopics['reports'];

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, close]);

  // Scroll to top when topic changes
  useEffect(() => {
    if (isOpen && bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }
  }, [topic, isOpen]);

  return (
    <>
      <style>{`
        .help-backdrop {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.3);
          z-index: 199;
          opacity: 0;
          transition: opacity 0.25s ease;
          pointer-events: none;
        }
        .help-backdrop.open {
          opacity: 1;
          pointer-events: auto;
        }

        .help-panel {
          position: fixed;
          top: 0; right: 0; bottom: 0;
          width: 400px;
          max-width: 100vw;
          background: #fff;
          z-index: 200;
          box-shadow: -4px 0 24px rgba(0,0,0,0.15);
          display: flex;
          flex-direction: column;
          transform: translateX(100%);
          transition: transform 0.25s ease;
        }
        .help-panel.open {
          transform: translateX(0);
        }

        .help-panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid #eee;
          background: linear-gradient(135deg, #1a5276, #2980b9);
          color: #fff;
          flex-shrink: 0;
        }
        .help-panel-header h2 {
          margin: 0;
          font-size: 17px;
          font-weight: 600;
        }
        .help-panel-close {
          background: rgba(255,255,255,0.15);
          border: none;
          color: #fff;
          width: 32px;
          height: 32px;
          border-radius: 6px;
          font-size: 18px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
          flex-shrink: 0;
        }
        .help-panel-close:hover {
          background: rgba(255,255,255,0.25);
        }

        .help-panel-body {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
          -webkit-overflow-scrolling: touch;
        }

        .help-section {
          margin-bottom: 20px;
        }
        .help-section:last-child {
          margin-bottom: 0;
        }
        .help-section-title {
          font-size: 14px;
          font-weight: 600;
          color: #2d3436;
          margin: 0 0 6px;
        }
        .help-section-body {
          font-size: 14px;
          line-height: 1.6;
          color: #555;
          white-space: pre-line;
          margin: 0;
        }

        .help-nav {
          padding: 12px 20px;
          border-top: 1px solid #eee;
          background: #f8f9fa;
          flex-shrink: 0;
        }
        .help-nav-label {
          font-size: 11px;
          font-weight: 600;
          color: #7f8c8d;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          margin-bottom: 6px;
        }
        .help-nav-links {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .help-nav-link {
          padding: 5px 12px;
          border-radius: 6px;
          border: 1px solid #dde1e6;
          background: #fff;
          font-size: 13px;
          cursor: pointer;
          color: #555;
          font-weight: 400;
        }
        .help-nav-link.active {
          border-color: #2980b9;
          background: #ebf5fb;
          color: #2980b9;
          font-weight: 600;
        }
        .help-nav-link:hover:not(.active) {
          border-color: #bbb;
        }

        /* Mobile: full-screen panel */
        @media (max-width: 768px) {
          .help-panel {
            width: 100vw;
          }
        }
      `}</style>

      {/* Backdrop */}
      <div className={`help-backdrop ${isOpen ? 'open' : ''}`} onClick={close} />

      {/* Panel */}
      <div className={`help-panel ${isOpen ? 'open' : ''}`}>
        <div className="help-panel-header">
          <h2>Help: {content.heading}</h2>
          <button className="help-panel-close" onClick={close} title="Close help">
            &times;
          </button>
        </div>

        <div className="help-panel-body" ref={bodyRef}>
          {content.sections.map((section, i) => (
            <div key={i} className="help-section">
              <h3 className="help-section-title">{section.title}</h3>
              <p className="help-section-body">{section.body}</p>
            </div>
          ))}
        </div>

        {/* Topic navigation */}
        <TopicNav currentTopic={topic} />
      </div>
    </>
  );
}

function TopicNav({ currentTopic }: { currentTopic: string }) {
  const { open } = useHelp();

  const topics = [
    { key: 'reports', label: 'Reports' },
    { key: 'report-edit', label: 'Report Form' },
    { key: 'customers', label: 'Customers' },
    { key: 'lookups', label: 'Lookups' },
    { key: 'users', label: 'Users' },
  ];

  return (
    <div className="help-nav">
      <div className="help-nav-label">Help Topics</div>
      <div className="help-nav-links">
        {topics.map((t) => (
          <button
            key={t.key}
            className={`help-nav-link ${currentTopic === t.key ? 'active' : ''}`}
            onClick={() => open(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
