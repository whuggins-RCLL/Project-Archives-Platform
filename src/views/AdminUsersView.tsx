import { useEffect, useMemo, useState } from 'react';
import { Shield, Search } from 'lucide-react';
import { api } from '../lib/api';
import { AdminAuditEntry, AppRole, ManagedUser } from '../types';

const ROLE_FILTERS: Array<AppRole | 'all'> = ['all', 'owner', 'admin', 'collaborator', 'viewer'];

function badgeClass(role: AppRole): string {
  if (role === 'owner') return 'bg-purple-100 text-purple-700';
  if (role === 'admin') return 'bg-blue-100 text-blue-700';
  if (role === 'collaborator') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-700';
}

export default function AdminUsersView({ canManageRoles }: { canManageRoles: boolean }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [audit, setAudit] = useState<AdminAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AppRole | 'all'>('all');
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextUsers, nextAudit] = await Promise.all([api.listManagedUsers(), api.listRoleAuditLogs()]);
      setUsers(nextUsers);
      setAudit(nextAudit);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const visible = useMemo(() => {
    return users.filter((user) => {
      const roleMatch = filter === 'all' || user.role === filter;
      const query = search.trim().toLowerCase();
      const searchMatch = !query || user.email.toLowerCase().includes(query) || user.displayName.toLowerCase().includes(query) || user.uid.toLowerCase().includes(query);
      return roleMatch && searchMatch;
    });
  }, [users, filter, search]);

  const mutateRole = async (uid: string, role: AppRole) => {
    if (!window.confirm(`Confirm role change to ${role}?`)) return;
    try {
      const message = await api.setUserRole(uid, role);
      setToast(message);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Role update failed');
    }
  };

  const mutateStatus = async (uid: string, action: 'disable' | 'enable') => {
    if (!window.confirm(`Confirm ${action} user access?`)) return;
    try {
      const message = await api.setUserStatus(uid, action);
      setToast(message);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status update failed');
    }
  };

  if (!canManageRoles) {
    return <div className="p-10 text-center"><Shield className="mx-auto w-14 h-14 text-error" /><h2 className="text-2xl font-bold mt-2">Access Denied</h2><p className="text-on-surface-variant">Only owners can manage roles.</p></div>;
  }

  return (
    <div className="p-8 space-y-6">
      {toast && <div className="fixed top-6 right-6 z-40 rounded-lg bg-tertiary-container px-4 py-2 text-sm font-bold">{toast}</div>}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-extrabold">Access Management</h1>
        <button className="px-4 py-2 rounded-lg border" onClick={() => void load()}>Refresh</button>
      </div>
      <div className="bg-white rounded-xl border p-4 flex gap-3 items-center">
        <Search className="w-4 h-4 text-slate-500" />
        <input className="flex-1 outline-none" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, uid" />
        <select value={filter} onChange={(e) => setFilter(e.target.value as AppRole | 'all')} className="border rounded px-3 py-2">
          {ROLE_FILTERS.map((role) => <option key={role} value={role}>{role === 'all' ? 'All roles' : role}</option>)}
        </select>
      </div>

      {error && <div className="rounded-lg border border-error/40 bg-error/10 p-3 text-sm">{error}</div>}
      {loading ? <div>Loading users...</div> : (
        <div className="bg-white rounded-xl border overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><th className="p-3 text-left">Name</th><th className="p-3 text-left">Email</th><th className="p-3 text-left">Role</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">UID</th><th className="p-3 text-left">Last Updated</th><th className="p-3 text-left">Actions</th></tr></thead>
            <tbody>
            {visible.map((user) => (
              <tr key={user.uid} className="border-t align-top">
                <td className="p-3">{user.displayName || '-'}</td>
                <td className="p-3">{user.email}</td>
                <td className="p-3"><span className={`px-2 py-1 rounded-full text-xs font-bold ${badgeClass(user.role)}`}>{user.role}</span></td>
                <td className="p-3">{user.status}</td>
                <td className="p-3 font-mono text-xs">{user.uid}</td>
                <td className="p-3 text-xs">{user.updatedAt || '-'}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-2">
                    {(['owner','admin','collaborator','viewer'] as AppRole[]).map((role) => (
                      <button key={role} className="px-2 py-1 border rounded text-xs" disabled={user.role === role} onClick={() => void mutateRole(user.uid, role)}>{role}</button>
                    ))}
                    {user.status === 'active'
                      ? <button className="px-2 py-1 border rounded text-xs" onClick={() => void mutateStatus(user.uid, 'disable')}>disable</button>
                      : <button className="px-2 py-1 border rounded text-xs" onClick={() => void mutateStatus(user.uid, 'enable')}>enable</button>}
                  </div>
                </td>
              </tr>
            ))}
            </tbody>
          </table>
          {visible.length === 0 && <div className="p-6 text-sm text-on-surface-variant">No users found.</div>}
        </div>
      )}

      <div className="bg-white rounded-xl border p-4">
        <h2 className="text-lg font-bold mb-2">Role Audit History</h2>
        <div className="space-y-2 max-h-64 overflow-auto">
          {audit.map((entry) => (
            <div key={entry.id} className="text-xs border rounded p-2">
              <strong>{entry.action}</strong> · {entry.actorEmail} → {entry.targetEmail} · {entry.oldRole || '-'} to {entry.newRole || '-'} · {entry.timestamp}
            </div>
          ))}
          {audit.length === 0 && <p className="text-sm text-on-surface-variant">No audit log entries yet.</p>}
        </div>
      </div>
    </div>
  );
}
