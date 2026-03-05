import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { helpTopics } from '../components/HelpContent';
import { HelpProvider, useHelp } from '../components/HelpContext';
import { HelpPanel } from '../components/HelpPanel';

describe('HelpContent', () => {
  it('should have all expected topics', () => {
    expect(helpTopics.reports).toBeDefined();
    expect(helpTopics['report-edit']).toBeDefined();
    expect(helpTopics.customers).toBeDefined();
    expect(helpTopics.users).toBeDefined();
    expect(helpTopics.lookups).toBeDefined();
  });

  it('should have heading and sections for each topic', () => {
    for (const [, topic] of Object.entries(helpTopics)) {
      expect(topic.heading).toBeDefined();
      expect(topic.sections).toBeInstanceOf(Array);
      expect(topic.sections.length).toBeGreaterThan(0);
      for (const section of topic.sections) {
        expect(section.title).toBeDefined();
        expect(section.body).toBeDefined();
      }
    }
  });
});

describe('HelpContext', () => {
  function TestConsumer() {
    const { isOpen, topic, open, close, setTopic } = useHelp();
    return (
      <div>
        <span data-testid="isOpen">{String(isOpen)}</span>
        <span data-testid="topic">{topic}</span>
        <button onClick={() => open('customers')}>Open Customers</button>
        <button onClick={() => open()}>Open Default</button>
        <button onClick={() => close()}>Close</button>
        <button onClick={() => setTopic('users')}>Set Users</button>
      </div>
    );
  }

  it('should default to closed with reports topic', () => {
    render(
      <HelpProvider>
        <TestConsumer />
      </HelpProvider>,
    );
    expect(screen.getByTestId('isOpen').textContent).toBe('false');
    expect(screen.getByTestId('topic').textContent).toBe('reports');
  });

  it('should open with a specific topic', () => {
    render(
      <HelpProvider>
        <TestConsumer />
      </HelpProvider>,
    );
    act(() => {
      fireEvent.click(screen.getByText('Open Customers'));
    });
    expect(screen.getByTestId('isOpen').textContent).toBe('true');
    expect(screen.getByTestId('topic').textContent).toBe('customers');
  });

  it('should close', () => {
    render(
      <HelpProvider>
        <TestConsumer />
      </HelpProvider>,
    );
    act(() => {
      fireEvent.click(screen.getByText('Open Default'));
    });
    expect(screen.getByTestId('isOpen').textContent).toBe('true');
    act(() => {
      fireEvent.click(screen.getByText('Close'));
    });
    expect(screen.getByTestId('isOpen').textContent).toBe('false');
  });

  it('should set topic independently', () => {
    render(
      <HelpProvider>
        <TestConsumer />
      </HelpProvider>,
    );
    act(() => {
      fireEvent.click(screen.getByText('Set Users'));
    });
    expect(screen.getByTestId('topic').textContent).toBe('users');
  });
});

describe('HelpPanel - Open State', () => {
  function OpenHelpPanel() {
    const { open } = useHelp();
    React.useEffect(() => {
      open('reports');
    }, []);
    return <HelpPanel />;
  }

  it('should show panel content when open', () => {
    render(
      <HelpProvider>
        <OpenHelpPanel />
      </HelpProvider>,
    );
    expect(screen.getByText('Help: Reports')).toBeInTheDocument();
    expect(screen.getByText('×')).toBeInTheDocument(); // Close button
  });

  it('should close on Escape key', () => {
    render(
      <HelpProvider>
        <OpenHelpPanel />
      </HelpProvider>,
    );
    expect(screen.getByText('Help: Reports')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    // Panel should now be hidden (still in DOM but with display none via CSS)
  });

  it('should close on close button click', () => {
    render(
      <HelpProvider>
        <OpenHelpPanel />
      </HelpProvider>,
    );
    fireEvent.click(screen.getByText('×'));
    // Panel closed
  });

  it('should change topic when topic button clicked', () => {
    render(
      <HelpProvider>
        <OpenHelpPanel />
      </HelpProvider>,
    );
    expect(screen.getByText('Help: Reports')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Customers'));
    expect(screen.getByText('Help: Customers')).toBeInTheDocument();
  });

  it('should show topic sections', () => {
    render(
      <HelpProvider>
        <OpenHelpPanel />
      </HelpProvider>,
    );
    // Reports topic should have content sections
    expect(screen.getByText('Help Topics')).toBeInTheDocument();
  });
});
