import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { Suspense, lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { persister, queryClient } from './lib/query'
import { VoteProvider } from './lib/vote-context'
import { Flow } from './pages/Flow'
import { HomePage } from './pages/HomePage'
import { PrivacyPage } from './pages/PrivacyPage'
import { ResultsView } from './pages/ResultsView'
import { VerifyPage } from './pages/VerifyPage'

// Administration chargée à part : les étudiants ne téléchargent jamais ce code.
const AdminApp = lazy(() => import('./admin/AdminApp'))

function VoterApp() {
  return (
    <VoteProvider>
      <Shell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/voter" element={<Flow />} />
          <Route path="/resultats" element={<ResultsView />} />
          <Route path="/verification" element={<VerifyPage />} />
          <Route path="/confidentialite" element={<PrivacyPage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </Shell>
    </VoteProvider>
  )
}

export default function App() {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24,
        // Seules les données publiques et de l'électeur vont dans le cache hors ligne ; jamais celles de la commission.
        dehydrateOptions: {
          shouldDehydrateQuery: (q) => q.state.status === 'success' && q.queryKey[0] !== 'admin',
        },
      }}
    >
      <BrowserRouter>
        <Routes>
          <Route
            path="/admin/*"
            element={
              <Suspense fallback={<div className="admin-root min-h-dvh" />}>
                <AdminApp />
              </Suspense>
            }
          />
          <Route path="*" element={<VoterApp />} />
        </Routes>
      </BrowserRouter>
    </PersistQueryClientProvider>
  )
}
