import { Navigate } from 'react-router-dom';
import { useAuthUser } from '../auth/useAuthUser';

export default function Protected({ children }) {
  const user = useAuthUser();
  if (user === null) {
    return <div className="page"><div className="card">Checking session…</div></div>;
  }
  return user ? children : <Navigate to="/login" replace />;
}
