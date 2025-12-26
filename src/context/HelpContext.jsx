import { createContext, useContext, useState, useCallback } from 'react';

const HelpContext = createContext(null);

export function useHelp() {
  const context = useContext(HelpContext);
  if (!context) {
    throw new Error('useHelp must be used within a HelpProvider');
  }
  return context;
}

export function HelpProvider({ children }) {
  const [showWalkthrough, setShowWalkthrough] = useState(false);

  const openWalkthrough = useCallback(() => {
    setShowWalkthrough(true);
  }, []);

  const closeWalkthrough = useCallback(() => {
    setShowWalkthrough(false);
  }, []);

  return (
    <HelpContext.Provider value={{ showWalkthrough, openWalkthrough, closeWalkthrough }}>
      {children}
    </HelpContext.Provider>
  );
}
