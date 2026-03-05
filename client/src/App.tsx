import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { User } from './types';
import { api } from './api';
import { Layout } from './components/Layout';
import { HelpProvider } from './components/HelpContext';
import { HelpPanel } from './components/HelpPanel';
import { Login } from './pages/Login';
import { Reports } from './pages/Reports';
import { ReportEdit } from './pages/ReportEdit';
import { Customers } from './pages/Customers';
import { Users } from './pages/Users';
import { Lookups } from './pages/Lookups';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const u = await api.login(username, password);
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <HelpProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Reports />} />
              <Route path="reports/new" element={<ReportEdit />} />
              <Route path="reports/:id" element={<ReportEdit />} />
              <Route path="customers" element={<Customers />} />
              <Route path="users" element={<Users />} />
              <Route path="lookups" element={<Lookups />} />
            </Route>
          </Routes>
          <HelpPanel />
        </HelpProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
