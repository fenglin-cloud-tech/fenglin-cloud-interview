import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PageSkeleton } from './components/ui';
import { AppProvider } from './state';

const Home = lazy(() => import('./pages/Home').then((m) => ({ default: m.Home })));
const Templates = lazy(() => import('./pages/Templates').then((m) => ({ default: m.Templates })));
const TemplateBuild = lazy(() => import('./pages/TemplateBuild').then((m) => ({ default: m.TemplateBuild })));
const Resumes = lazy(() => import('./pages/Resumes').then((m) => ({ default: m.Resumes })));
const Experiences = lazy(() => import('./pages/Experiences').then((m) => ({ default: m.Experiences })));
const ResumeCompare = lazy(() =>
  import('./pages/ResumeCompare').then((m) => ({ default: m.ResumeCompare })),
);
const Jobs = lazy(() => import('./pages/Jobs').then((m) => ({ default: m.Jobs })));
const JobSkills = lazy(() => import('./pages/JobSkills').then((m) => ({ default: m.JobSkills })));
const Optimize = lazy(() => import('./pages/Optimize').then((m) => ({ default: m.Optimize })));
const Interviews = lazy(() => import('./pages/Interviews').then((m) => ({ default: m.Interviews })));
const Pitch = lazy(() => import('./pages/Pitch').then((m) => ({ default: m.Pitch })));
const InterviewSession = lazy(() =>
  import('./pages/InterviewSession').then((m) => ({ default: m.InterviewSession })),
);
const InterviewReport = lazy(() => import('./pages/InterviewReport').then((m) => ({ default: m.InterviewReport })));
const Reviews = lazy(() => import('./pages/Reviews').then((m) => ({ default: m.Reviews })));
const Bank = lazy(() => import('./pages/Bank').then((m) => ({ default: m.Bank })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const Privacy = lazy(() => import('./pages/Privacy').then((m) => ({ default: m.Privacy })));
const Backup = lazy(() => import('./pages/Backup').then((m) => ({ default: m.Backup })));
const Applications = lazy(() => import('./pages/Applications').then((m) => ({ default: m.Applications })));
const ImportResume = lazy(() => import('./pages/ImportResume').then((m) => ({ default: m.ImportResume })));
const PrintResume = lazy(() => import('./pages/PrintResume').then((m) => ({ default: m.PrintResume })));
const PrintReviews = lazy(() => import('./pages/PrintReviews').then((m) => ({ default: m.PrintReviews })));
const PrintProfile = lazy(() => import('./pages/PrintProfile').then((m) => ({ default: m.PrintProfile })));
const PrintInterview = lazy(() =>
  import('./pages/PrintInterview').then((m) => ({ default: m.PrintInterview })),
);
const NotFound = lazy(() => import('./pages/NotFound').then((m) => ({ default: m.NotFound })));

export function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <ErrorBoundary>
          <Suspense
            fallback={
              <div className="page">
                <PageSkeleton variant="cards" label="正在加载页面" />
              </div>
            }
          >
            <Routes>
              <Route path="print/resume/:id" element={<PrintResume />} />
              <Route path="print/reviews" element={<PrintReviews />} />
              <Route path="print/profile" element={<PrintProfile />} />
              <Route path="print/interview/:id" element={<PrintInterview />} />
              <Route element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="templates" element={<Templates />} />
                <Route path="templates/:id" element={<TemplateBuild />} />
                <Route path="import" element={<ImportResume />} />
                <Route path="resumes" element={<Resumes />} />
                <Route path="experiences" element={<Experiences />} />
                <Route path="resumes/compare" element={<ResumeCompare />} />
                <Route path="jobs" element={<Jobs />} />
                <Route path="jobs/:id/skills" element={<JobSkills />} />
                <Route path="optimize" element={<Optimize />} />
                <Route path="interviews" element={<Interviews />} />
                <Route path="pitch" element={<Pitch />} />
                <Route path="interviews/:id/session" element={<InterviewSession />} />
                <Route path="interviews/:id/report" element={<InterviewReport />} />
                <Route path="reviews" element={<Reviews />} />
                <Route path="bank" element={<Bank />} />
                <Route path="profile" element={<ProfilePage />} />
                <Route path="privacy" element={<Privacy />} />
                <Route path="backup" element={<Backup />} />
                <Route path="applications" element={<Applications />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </BrowserRouter>
    </AppProvider>
  );
}
