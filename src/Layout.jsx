import { useLocation } from 'react-router-dom';
import Ticker from './Ticker';
import Header from './Header';
import './layout.css'; // Make sure this file exists

function Layout({ children }) {
  const location = useLocation();
  const pathname = location.pathname;

  const isDarkPage = pathname === '/draft' || pathname === '/leagues';
  const isGridPage = pathname === '/draft'; // add more if needed

  return (
    <div className={`min-h-screen ${isDarkPage ? 'bg-[#0f172a] text-white' : 'bg-gray-100 text-black'}`}>
      <Ticker />
      <Header />
      <main
        className={`
          mx-auto px-4 mt-8
          ${isGridPage ? 'custom-grid-layout' : 'max-w-xl'}
        `}
      >
        {children}
      </main>
    </div>
  );
}

export default Layout;
