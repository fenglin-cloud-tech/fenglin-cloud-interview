import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AppProvider } from './state';
import { Home } from './pages/Home';
import { Templates } from './pages/Templates';
import { TemplateBuild } from './pages/TemplateBuild';
import { Resumes } from './pages/Resumes';
import { Jobs } from './pages/Jobs';
import { Optimize } from './pages/Optimize';
import { Interviews } from './pages/Interviews';
import { InterviewSession } from './pages/InterviewSession';
import { InterviewReport } from './pages/InterviewReport';
import { Reviews } from './pages/Reviews';
import { Bank } from './pages/Bank';
import { ProfilePage } from './pages/ProfilePage';
import { Privacy } from './pages/Privacy';
import { NotFound } from './pages/NotFound';

export function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="templates" element={<Templates />} />
            <Route path="templates/:id" element={<TemplateBuild />} />
            <Route path="resumes" element={<Resumes />} />
            <Route path="jobs" element={<Jobs />} />
            <Route path="optimize" element={<Optimize />} />
            <Route path="interviews" element={<Interviews />} />
            <Route path="interviews/:id/session" element={<InterviewSession />} />
            <Route path="interviews/:id/report" element={<InterviewReport />} />
            <Route path="reviews" element={<Reviews />} />
            <Route path="bank" element={<Bank />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="privacy" element={<Privacy />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
