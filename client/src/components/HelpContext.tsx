import React, { createContext, useContext, useState, useCallback } from 'react';

interface HelpContextType {
  isOpen: boolean;
  topic: string;
  open: (topic?: string) => void;
  close: () => void;
  setTopic: (topic: string) => void;
}

const HelpContext = createContext<HelpContextType>({
  isOpen: false,
  topic: 'reports',
  open: () => {},
  close: () => {},
  setTopic: () => {},
});

export const useHelp = () => useContext(HelpContext);

export function HelpProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [topic, setTopic] = useState('reports');

  const open = useCallback((t?: string) => {
    if (t) setTopic(t);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  return <HelpContext.Provider value={{ isOpen, topic, open, close, setTopic }}>{children}</HelpContext.Provider>;
}
