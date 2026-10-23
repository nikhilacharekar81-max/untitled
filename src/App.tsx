/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  ShieldCheck, 
  Search, 
  Briefcase, 
  DollarSign, 
  User as UserIcon, 
  Settings, 
  MessageSquare, 
  CheckCircle2, 
  Lock, 
  Zap, 
  SlidersHorizontal,
  LogOut,
  Bell,
  Star,
  ExternalLink,
  PlusCircle,
  HelpCircle,
  ArrowRight,
  Clock,
  Check
} from 'lucide-react';
import { useAppData } from './hooks/useAppData';
import { useWorkstream } from './hooks/workstream/useWorkstream';
import { Header } from './layout/Header';
import { Footer } from './layout/Footer';
import { MarketplaceGigsView } from './components/marketplace/MarketplaceGigsView';
import {
  WorkstreamWorkspace,
  WorkstreamSidebar,
  WorkstreamList,
  StartWorkstreamModal,
  type WorkstreamFilter
} from './components/workstream';
import { AdminPage } from './pages/AdminPage';
import { SettingsPage } from './components/SettingsPage';
import { UserWalletsLedgerModule } from './components/UserWalletsLedgerModule';
import { PaymentsModule } from './components/PaymentsModule';
import { LoginModal, SignupModal, UserSwitchModal, ForgotPasswordModal } from './components/modals';
import { slugify } from './utils/slugify';
import { PPH_CATEGORIES } from './components/HeaderCategoriesNav';
import { getAuthToken, setAuthToken, clearAuthToken, requestDemoSession, installAuthFetch } from './utils/authToken';
import { getDeviceId } from './utils/deviceId';

declare global {
  interface Window {
    __INITIAL_DATA__?: any;
  }
}

export default function App({ initialPath = '/', initialData }: { initialPath?: string; initialData?: any } = {}) {
  const resolvedInitialData = initialData || (typeof window !== 'undefined' ? window.__INITIAL_DATA__ : undefined);
  const [path, setPath] = useState(initialPath || (typeof window !== 'undefined' ? window.location.pathname : '/'));
  const appData = useAppData(resolvedInitialData);
  const { users, gigs, projects, orders, proposals, messages, setMessages, setReviews, setOrders, refresh } = appData;

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [impersonatedUser, setImpersonatedUser] = useState<any>(null);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [likedGigIds, setLikedGigIds] = useState<string[]>([]);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isSignupOpen, setIsSignupOpen] = useState(false);
  const [isSwitchUserOpen, setIsSwitchUserOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentCategory, setCurrentCategory] = useState('All');
  const [gigViewMode, setGigViewMode] = useState<'grid' | 'list'>('grid');
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [serviceOptionFilter, setServiceOptionFilter] = useState('all');
  const [sellerLevelFilter, setSellerLevelFilter] = useState('all');
  const [budgetFilter, setBudgetFilter] = useState('all');
  const [deliveryTimeFilter, setDeliveryTimeFilter] = useState<number | null>(null);
  const [onlineNowOnly, setOnlineNowOnly] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Workstream filter & modal state
  const [workstreamTab, setWorkstreamTab] = useState<WorkstreamFilter>('all');
  const [starredWorkstreams, setStarredWorkstreams] = useState<string[]>([]);
  const [selectedPersonFilter, setSelectedPersonFilter] = useState<string | null>(null);
  const [peopleSearch, setPeopleSearch] = useState('');
  const [projectFilterSearch, setProjectFilterSearch] = useState('');
  const [workstreamSearch, setWorkstreamSearch] = useState('');
  const [isStartWorkstreamModalOpen, setIsStartWorkstreamModalOpen] = useState(false);

  // Login form state for LoginModal
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [loginRequiresCode, setLoginRequiresCode] = useState(false);
  const [loginVerificationMessage, setLoginVerificationMessage] = useState('');
  const [mockEmailCodeDisplay, setMockEmailCodeDisplay] = useState<string | null>(null);

  // Signup form state for SignupModal
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupMobile, setSignupMobile] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');

  // Forgot Password modal state
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState(false);
  const [forgotStep, setForgotStep] = useState<'request' | 'verify' | 'reset'>('request');
  const [forgotQuery, setForgotQuery] = useState('');
  const [forgotCode, setForgotCode] = useState('');
  const [mockForgotCodeDisplay, setMockForgotCodeDisplay] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  }, []);

  const handleForgotRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: forgotQuery })
      });
      const data = await res.json();
      if (res.ok) {
        if (data.mockCode) setMockForgotCodeDisplay(data.mockCode);
        setForgotStep('verify');
        showToast('Recovery code sent successfully!');
      } else {
        showToast(data.error || 'User not found');
      }
    } catch {
      showToast('Failed to send recovery code');
    }
  };

  const handleForgotVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth/verify-recovery-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: forgotQuery, code: forgotCode })
      });
      const data = await res.json();
      if (res.ok) {
        setForgotStep('reset');
        showToast('Code verified. Set new password.');
      } else {
        showToast(data.error || 'Invalid recovery code');
      }
    } catch {
      showToast('Failed to verify code');
    }
  };

  const handleForgotReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmNewPassword) {
      showToast('Passwords do not match');
      return;
    }
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: forgotQuery, code: forgotCode, newPassword })
      });
      const data = await res.json();
      if (res.ok) {
        setIsForgotPasswordOpen(false);
        setForgotStep('request');
        setForgotCode('');
        setNewPassword('');
        setConfirmNewPassword('');
        showToast('Password reset successfully. Please log in.');
        setIsLoginOpen(true);
      } else {
        showToast(data.error || 'Failed to reset password');
      }
    } catch {
      showToast('Failed to reset password');
    }
  };

  const loadUserSession = useCallback(async () => {
    if (typeof window !== 'undefined') {
      installAuthFetch();
    }
    const token = getAuthToken();
    if (!token) {
      const loggedOut = typeof window !== 'undefined' && localStorage.getItem('workperhour_logged_out') === 'true';
      if (!loggedOut) {
        const demo = await requestDemoSession('u2');
        if (demo?.token && demo?.user) {
          setAuthToken(demo.token);
          setCurrentUser(demo.user);
          await refresh(demo.user.id);
          return true;
        }
      }
      setCurrentUser(null);
      return false;
    }
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}`, 'x-device-id': getDeviceId() }
      });
      if (res.ok) {
        const u = await res.json();
        setCurrentUser(u);
        await refresh(u.id);
        return true;
      } else {
        clearAuthToken();
        setCurrentUser(null);
        return false;
      }
    } catch {
      return false;
    }
  }, [refresh]);

  useEffect(() => {
    loadUserSession();
    refresh();
  }, [loadUserSession, refresh]);

  useEffect(() => {
    const handleNotify = (e: any) => {
      if (e.detail) {
        showToast(String(e.detail));
      }
    };
    window.addEventListener('app:notify' as any, handleNotify);
    return () => window.removeEventListener('app:notify' as any, handleNotify);
  }, [showToast]);

  useEffect(() => {
    const onPopState = () => {
      setPath(window.location.pathname);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string, e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', to);
    }
    if (to === '/workstreams' || to === '/messages' || to === '/orders') {
      setSelectedOrder(null);
    }
    setPath(to);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleToggleLike = (gigId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setLikedGigIds(prev => prev.includes(gigId) ? prev.filter(id => id !== gigId) : [...prev, gigId]);
  };

  const effectiveUser = impersonatedUser || currentUser;

  const workstream = useWorkstream({
    currentUser,
    impersonatedUser,
    orders,
    setOrders,
    usersList: users,
    gigs,
    projects,
    messages,
    setMessages,
    setReviews,
    selectedOrder,
    setSelectedOrder,
    workstreamTab,
    starredWorkstreams,
    selectedPersonFilter,
    projectFilterSearch,
    workstreamSearch,
    setIsStartWorkstreamModalOpen,
    navigate,
    refresh
  });

  // Synchronize URL routes (/workstream/:id, /workstreams/:id, /messages/:id, /orders/:id) with selectedOrder
  useEffect(() => {
    const match = path.match(/^\/(?:workstream|workstreams|messages|orders)\/([^/?#]+)/);
    if (!match) return;
    const targetOrderId = decodeURIComponent(match[1]);
    if (!targetOrderId) return;

    if (selectedOrder?.id === targetOrderId) {
      return;
    }

    const existing = orders.find(o => o.id === targetOrderId);
    if (existing) {
      setSelectedOrder(existing);
      workstream.fetchMessages(targetOrderId);
      return;
    }

    const token = getAuthToken();
    if (!token) return;
    fetch(`/api/orders/${encodeURIComponent(targetOrderId)}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'x-device-id': getDeviceId() }
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data && data.id) {
          setSelectedOrder(data);
          if (Array.isArray(data.messages)) {
            setMessages(prev => {
              const other = prev.filter(m => m.orderId !== data.id);
              return [...other, ...data.messages];
            });
          } else {
            workstream.fetchMessages(data.id);
          }
        }
      })
      .catch(() => {});
  }, [path, orders, selectedOrder?.id, setMessages, workstream]);

  const isWorkstreamRoute =
    path === '/workstreams' ||
    path.startsWith('/workstreams/') ||
    path.startsWith('/workstream/') ||
    path === '/messages' ||
    path.startsWith('/messages/') ||
    path === '/orders' ||
    path.startsWith('/orders/');

  const filteredGigs = gigs.filter(g => {
    if (currentCategory !== 'All' && g.category !== currentCategory) return false;
    if (searchQuery.trim() && !g.title.toLowerCase().includes(searchQuery.toLowerCase()) && !g.description.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    return true;
  });

  const selectedPersonObj = selectedPersonFilter
    ? users.find(u => u.id === selectedPersonFilter)
    : null;

  const activeWorkstreamOrder = workstream.selectedOrder || selectedOrder;
  const activeOrderMessages = activeWorkstreamOrder
    ? messages.filter(m => m.orderId === activeWorkstreamOrder.id)
    : [];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 bg-slate-900 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-slate-800 animate-bounce">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <span className="text-sm font-medium">{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <Header 
        navigate={navigate}
        currentUser={effectiveUser}
        orders={orders}
        likedGigIds={likedGigIds}
        isGigsList={path === '/' || path === '/gigs'}
        isGigDetail={path.startsWith('/gig/')}
        isProjectsList={path === '/projects'}
        isProjectDetail={path.startsWith('/project/')}
        isCategoryRoute={false}
        loadUserSession={loadUserSession}
        updateCurrentUser={setCurrentUser}
        setImpersonatedUser={setImpersonatedUser}
        setSelectedOrder={setSelectedOrder}
        setPath={setPath}
        fetchMessages={workstream.fetchMessages}
        onOpenLogin={() => setIsLoginOpen(true)}
        onOpenSignup={() => setIsSignupOpen(true)}
        onOpenSwitchUser={() => setIsSwitchUserOpen(true)}
      />

      {/* Main Content Router */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {path.startsWith('/admin') ? (
          <AdminPage 
            currentUser={effectiveUser}
            impersonatedUser={impersonatedUser}
            updateCurrentUser={setCurrentUser}
            setImpersonatedUser={setImpersonatedUser}
            usersList={users}
            setUsersList={() => {}}
            projects={projects}
            gigs={gigs}
            orders={orders}
            proposals={proposals}
            navigate={navigate}
            refresh={async () => { await refresh(); }}
          />
        ) : isWorkstreamRoute || activeWorkstreamOrder ? (
          activeWorkstreamOrder ? (
            <WorkstreamWorkspace 
              order={activeWorkstreamOrder}
              currentUser={effectiveUser}
              messages={activeOrderMessages}
              files={workstream.activeSharedFiles}
              onBack={() => {
                setSelectedOrder(null);
                navigate('/messages');
              }}
              onSendMessage={(text: string) => {
                workstream.sendMessage(text, 'text', undefined, activeWorkstreamOrder.id);
              }}
              onRetryMessage={(msg) => {
                workstream.retryMessage(msg as any);
              }}
              onAttachFile={(file) => {
                workstream.sendMessage(`Shared file: ${file.name}`, 'file', file, activeWorkstreamOrder.id);
              }}
              sendEvent={workstream.sendEvent}
              onDeliverWork={workstream.handleDeliverWork}
              onReleaseEscrow={workstream.handleReleaseEscrow}
              onRequestRevision={workstream.handleRequestRevision}
              isReviewModalOpen={workstream.isReviewModalOpen}
              setIsReviewModalOpen={workstream.setIsReviewModalOpen}
              handleSubmitReview={workstream.handleSubmitReview}
              reviewError={workstream.reviewError}
              isSubmittingReview={workstream.isSubmittingReview}
              escrowError={workstream.escrowError}
              onOrderChanged={(updated: any, followOnOrder?: any) => {
                if (followOnOrder && followOnOrder.id) {
                  setOrders(prev => [followOnOrder, ...prev.filter(o => o.id !== followOnOrder.id)]);
                  setSelectedOrder(followOnOrder);
                  workstream.fetchMessages(followOnOrder.id);
                  navigate(`/messages/${followOnOrder.id}`);
                } else if (updated && updated.id) {
                  setSelectedOrder((prev: any) => (prev && prev.id === updated.id ? { ...prev, ...updated } : updated));
                  setOrders(prev => prev.map(o => (o.id === updated.id ? { ...o, ...updated } : o)));
                }
                refresh();
              }}
              usersList={users}
            />
          ) : (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Workstreams & Collaboration</h1>
                  <p className="text-xs text-slate-500 mt-1">
                    Manage active escrow orders, real-time messaging, deliverables, invoices, and project milestones.
                  </p>
                </div>
                <button
                  onClick={() => setIsStartWorkstreamModalOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer self-start sm:self-auto"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>Start New Workstream</span>
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-4 xl:col-span-3">
                  <WorkstreamSidebar
                    currentTab={workstreamTab}
                    onTabChange={setWorkstreamTab}
                    orders={workstream.hydratedWorkstreamItems}
                    starredCount={starredWorkstreams.length}
                    projects={projects}
                    usersList={users}
                    currentUser={effectiveUser}
                    selectedPersonFilter={selectedPersonFilter}
                    onSelectPersonFilter={setSelectedPersonFilter}
                    peopleSearch={peopleSearch}
                    onPeopleSearchChange={setPeopleSearch}
                    projectSearch={projectFilterSearch}
                    onProjectSelect={(title) => setProjectFilterSearch(prev => (prev === title ? '' : title))}
                  />
                </div>
                <div className="lg:col-span-8 xl:col-span-9">
                  <WorkstreamList
                    workstreams={workstream.filteredWorkstreamItems}
                    selectedOrderId={(activeWorkstreamOrder as any)?.id}
                    onSelectOrder={(orderId: string) => {
                      const found = workstream.hydratedWorkstreamItems.find(o => o.id === orderId) || orders.find(o => o.id === orderId);
                      if (found) {
                        setSelectedOrder(found);
                      }
                      workstream.fetchMessages(orderId);
                      navigate(`/messages/${orderId}`);
                    }}
                    starredIds={starredWorkstreams}
                    onToggleStar={(orderId: string) => {
                      setStarredWorkstreams(prev =>
                        prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]
                      );
                    }}
                    searchQuery={workstreamSearch}
                    onSearchChange={setWorkstreamSearch}
                    onStartNewWorkstream={() => setIsStartWorkstreamModalOpen(true)}
                    activeTab={workstreamTab}
                    selectedPersonName={selectedPersonObj?.name || null}
                    selectedProjectTitle={projectFilterSearch || null}
                    onClearTab={() => setWorkstreamTab('all')}
                    onClearPersonFilter={() => setSelectedPersonFilter(null)}
                    onClearProjectFilter={() => setProjectFilterSearch('')}
                    onClearAllFilters={() => {
                      setWorkstreamTab('all');
                      setSelectedPersonFilter(null);
                      setProjectFilterSearch('');
                      setWorkstreamSearch('');
                    }}
                  />
                </div>
              </div>

              <StartWorkstreamModal
                isOpen={isStartWorkstreamModalOpen}
                onClose={() => setIsStartWorkstreamModalOpen(false)}
                onSubmit={workstream.handleStartWorkstreamModalSubmit}
                usersList={users}
                currentUser={effectiveUser}
              />
            </div>
          )
        ) : path.startsWith('/wallets') ? (
          <UserWalletsLedgerModule currentUser={effectiveUser} />
        ) : path.startsWith('/payments') ? (
          <PaymentsModule currentUser={effectiveUser} />
        ) : path.startsWith('/settings') ? (
          <SettingsPage 
            currentUser={effectiveUser}
            updateCurrentUser={setCurrentUser}
            navigate={navigate}
          />
        ) : (
          <MarketplaceGigsView 
            filteredGigs={filteredGigs}
            projects={projects}
            currentCategory={currentCategory}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            activeDropdown={activeDropdown}
            setActiveDropdown={setActiveDropdown}
            serviceOptionFilter={serviceOptionFilter}
            setServiceOptionFilter={setServiceOptionFilter}
            sellerLevelFilter={sellerLevelFilter}
            setSellerLevelFilter={setSellerLevelFilter}
            budgetFilter={budgetFilter}
            setBudgetFilter={setBudgetFilter}
            deliveryTimeFilter={deliveryTimeFilter}
            setDeliveryTimeFilter={setDeliveryTimeFilter}
            onlineNowOnly={onlineNowOnly}
            setOnlineNowOnly={setOnlineNowOnly}
            gigViewMode={gigViewMode}
            setGigViewMode={setGigViewMode}
            likedGigIds={likedGigIds}
            handleToggleLike={handleToggleLike}
            navigate={navigate}
            getGigUrl={(g) => `/gig/${g.id}/${slugify(g.title)}`}
            currentUser={effectiveUser}
            setIsSignupModalOpen={setIsSignupOpen}
            slugify={slugify}
            CATEGORY_SLUGS={Object.fromEntries(PPH_CATEGORIES.map(c => [c.name, c.slug]))}
          />
        )}
      </main>

      {/* Footer */}
      <Footer navigate={navigate} />

      {/* Modals */}
      {isLoginOpen && (
        <LoginModal 
          isOpen={isLoginOpen}
          onClose={() => setIsLoginOpen(false)}
          loginRequiresCode={loginRequiresCode}
          loginVerificationMessage={loginVerificationMessage}
          mockEmailCodeDisplay={mockEmailCodeDisplay}
          loginEmail={loginEmail}
          setLoginEmail={setLoginEmail}
          loginPassword={loginPassword}
          setLoginPassword={setLoginPassword}
          loginCode={loginCode}
          setLoginCode={setLoginCode}
          handleLoginSubmit={async (e: React.FormEvent) => {
            e.preventDefault();
            await loadUserSession();
            setIsLoginOpen(false);
          }}
          setLoginRequiresCode={setLoginRequiresCode}
          usersList={users}
          updateCurrentUser={setCurrentUser}
          setImpersonatedUser={setImpersonatedUser}
          refresh={refresh}
          setIsForgotPasswordModalOpen={setIsForgotPasswordOpen}
          setMockEmailCodeDisplay={setMockEmailCodeDisplay}
          onSwitchToSignup={() => { setIsLoginOpen(false); setIsSignupOpen(true); }}
        />
      )}

      {isSignupOpen && (
        <SignupModal 
          isOpen={isSignupOpen}
          onClose={() => setIsSignupOpen(false)}
          handleSignupSubmit={async (e: React.FormEvent) => {
            e.preventDefault();
            await loadUserSession();
            setIsSignupOpen(false);
          }}
          signupName={signupName}
          setSignupName={setSignupName}
          signupEmail={signupEmail}
          setSignupEmail={setSignupEmail}
          signupMobile={signupMobile}
          setSignupMobile={setSignupMobile}
          signupPassword={signupPassword}
          setSignupPassword={setSignupPassword}
          signupConfirmPassword={signupConfirmPassword}
          setSignupConfirmPassword={setSignupConfirmPassword}
          onSwitchToLogin={() => { setIsSignupOpen(false); setIsLoginOpen(true); }}
        />
      )}

      {isForgotPasswordOpen && (
        <ForgotPasswordModal
          isOpen={isForgotPasswordOpen}
          onClose={() => setIsForgotPasswordOpen(false)}
          forgotStep={forgotStep}
          setForgotStep={setForgotStep}
          forgotQuery={forgotQuery}
          setForgotQuery={setForgotQuery}
          forgotCode={forgotCode}
          setForgotCode={setForgotCode}
          mockForgotCodeDisplay={mockForgotCodeDisplay}
          newPassword={newPassword}
          setNewPassword={setNewPassword}
          confirmNewPassword={confirmNewPassword}
          setConfirmNewPassword={setConfirmNewPassword}
          handleForgotRequest={handleForgotRequest}
          handleForgotVerify={handleForgotVerify}
          handleForgotReset={handleForgotReset}
          setForgotCodeEmpty={() => setForgotCode('')}
        />
      )}

      {isSwitchUserOpen && (
        <UserSwitchModal 
          isOpen={isSwitchUserOpen}
          onClose={() => setIsSwitchUserOpen(false)}
          usersList={users}
          currentUser={effectiveUser}
          setCurrentUser={setCurrentUser}
          setImpersonatedUser={setImpersonatedUser}
          refresh={refresh}
        />
      )}
    </div>
  );
}
