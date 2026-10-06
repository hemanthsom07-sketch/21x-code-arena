import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { RequireRole } from './components/Guards'
import Login from './pages/Login'
import QuestionManager from './pages/admin/QuestionManager'
import { ChallengePage, QuestionPage } from './pages/student/ChallengeViews'
import { StudentDashboard, AdminDashboard } from './pages/Dashboards'
import Activate from './pages/Activate'
import Leaderboard from './pages/student/Leaderboard'
import MySubmissions from './pages/student/MySubmissions'
import AdminEvent from './pages/admin/AdminEvent'
import AdminParticipants from './pages/admin/AdminParticipants'
import AdminMonitor from './pages/admin/AdminMonitor'
import AdminResults from './pages/admin/AdminResults'

export default function App() {
  return (
    <AuthProvider><BrowserRouter><Routes>
      <Route path="/login" element={<Login role="student" />} />
      <Route path="/admin/login" element={<Login role="admin" />} />
      <Route path="/activate" element={<Activate />} />
      <Route element={<RequireRole role="student" />}><Route path="/" element={<StudentDashboard />} />
        <Route path="/challenges/:id" element={<ChallengePage />} />
        <Route path="/questions/:id" element={<QuestionPage />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/submissions" element={<MySubmissions />} /></Route>
      <Route path="/admin" element={<RequireRole role="admin" />}><Route index element={<AdminDashboard />} />
        <Route path="challenges/:id" element={<QuestionManager />} />
        <Route path="event" element={<AdminEvent />} />
        <Route path="participants" element={<AdminParticipants />} />
        <Route path="monitor" element={<AdminMonitor />} />
        <Route path="results" element={<AdminResults />} /></Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></BrowserRouter></AuthProvider>
  )
}
