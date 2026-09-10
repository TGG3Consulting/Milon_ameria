import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import AdminPage from './admin/AdminPage.jsx';

function Root() {
  const [isAdmin, setIsAdmin] = React.useState(() => window.location.hash === '#admin');

  React.useEffect(() => {
    const handleHashChange = () => setIsAdmin(window.location.hash === '#admin');
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return isAdmin ? <AdminPage /> : <App />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
