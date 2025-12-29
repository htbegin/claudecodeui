import React, { createContext, useContext } from 'react';
import { useRealtimeStream } from '../utils/realtime';

const RealtimeContext = createContext({
  sendMessage: () => {},
  messages: [],
  isConnected: false,
  clientId: null
});

export const useRealtimeContext = () => {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error('useRealtimeContext must be used within a RealtimeProvider');
  }
  return context;
};

export const RealtimeProvider = ({ children }) => {
  const realtimeData = useRealtimeStream();

  return (
    <RealtimeContext.Provider value={realtimeData}>
      {children}
    </RealtimeContext.Provider>
  );
};

export default RealtimeContext;
