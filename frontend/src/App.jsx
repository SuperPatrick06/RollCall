import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  BookOpenCheck,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleMinus,
  CirclePlus,
  Clock3,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FilePenLine,
  Gauge,
  KeyRound,
  ListChecks,
  LoaderCircle,
  LogOut,
  Mail,
  MailCheck,
  Medal,
  Menu,
  Minus,
  Plus,
  RefreshCw,
  Save,
  ScrollText,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Trash2,
  Trophy,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react'
import { api, getToken, setToken } from './api.js'

const navItems = [
  { id: 'attendance', label: '签到', icon: ListChecks },
  { id: 'ranking', label: '排行', icon: Trophy },
  { id: 'records', label: '考核', icon: FilePenLine },
  { id: 'analytics', label: '分析', icon: BarChart3 },
  { id: 'logs', label: '日志', icon: ScrollText },
]

function localDateValue(value = new Date()) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function currentMonthValue() {
  return localDateValue().slice(0, 7)
}

function formatMinutes(minutes = 0) {
  const hours = minutes / 60
  return `${Number(hours.toFixed(1))} 小时`
}

function formatShortDate(value) {
  if (!value) return '—'
  const [year, month, day] = value.split('-')
  return `${year}.${month}.${day}`
}

function formatMonth(value) {
  if (!value) return '全部时间'
  const [year, month] = value.split('-')
  return `${year} 年 ${Number(month)} 月`
}

function todayLabel() {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date())
}

function formatLogTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hours}:${minutes}`
}

function classNames(...values) {
  return values.filter(Boolean).join(' ')
}

function IconButton({ label, children, className = '', ...props }) {
  return (
    <button className={`icon-button ${className}`} title={label} aria-label={label} {...props}>
      {children}
    </button>
  )
}

function EmptyState({ icon: Icon = Search, title, detail }) {
  return (
    <div className="empty-state">
      <Icon size={22} />
      <strong>{title}</strong>
      {detail && <span>{detail}</span>}
    </div>
  )
}

function Spinner({ label = '正在载入' }) {
  return (
    <div className="spinner-wrap">
      <LoaderCircle className="spin" size={20} />
      <span>{label}</span>
    </div>
  )
}

function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(onClose, 3200)
    return () => window.clearTimeout(timer)
  }, [toast, onClose])

  if (!toast) return null
  return (
    <div className={`toast toast-${toast.type}`} role="status">
      {toast.type === 'error' ? <AlertTriangle size={18} /> : <Check size={18} />}
      <span>{toast.message}</span>
      <IconButton label="关闭提示" onClick={onClose}>
        <X size={16} />
      </IconButton>
    </div>
  )
}

function Modal({ title, children, onClose, size = 'normal' }) {
  useEffect(() => {
    const handleKey = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          <IconButton label="关闭" onClick={onClose}>
            <X size={19} />
          </IconButton>
        </header>
        {children}
      </section>
    </div>
  )
}

function MemberPicker({ id, value, onChange, members, required = true, autoFocus = false }) {
  const listId = `${id}-members`
  return (
    <div className="input-with-icon">
      <UserRound size={17} />
      <input
        id={id}
        list={listId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="输入成员编号"
        autoComplete="off"
        required={required}
        autoFocus={autoFocus}
      />
      <datalist id={listId}>
        {members.map((member) => (
          <option key={member.id} value={member.member_no}>
            {member.name}
          </option>
        ))}
      </datalist>
    </div>
  )
}

function DurationControl({ minutes, onChange, max = 720 }) {
  const update = (next) => onChange(Math.min(max, Math.max(15, next)))
  return (
    <div className="duration-control">
      <div className="duration-value">
        <Clock3 size={19} />
        <strong>{formatMinutes(minutes)}</strong>
      </div>
      <div className="duration-adjust">
        <IconButton label="减少十五分钟" onClick={() => update(minutes - 15)} type="button">
          <Minus size={18} />
        </IconButton>
        <input
          aria-label="出勤时长"
          type="range"
          min="15"
          max={max}
          step="15"
          value={minutes}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <IconButton label="增加十五分钟" onClick={() => update(minutes + 15)} type="button">
          <Plus size={18} />
        </IconButton>
      </div>
    </div>
  )
}

function LoginScreen({ onLogin, notify }) {
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      })
      setToken(result.token)
      onLogin()
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-screen">
      <div className="login-brand">
        <div className="login-brand-inner">
          <div className="login-brand-head">
            <img className="login-mark" src="/assets/logo.svg" alt="" />
            <div className="login-brand-copy">
              <strong>RollCall</strong>
              <span>GENERIC ATTENDANCE SYSTEM</span>
            </div>
          </div>
          <img className="login-art" src="/assets/login-art.svg" alt="RollCall 产品界面预览" />
          <ul className="login-highlights">
            <li><Check size={15} />签到 · 时长排行 · 考核 · 违规扣时</li>
            <li><Check size={15} />出勤分析 · CSV 报表 · 邮件月报</li>
            <li><Check size={15} />自托管部署 · 数据完全自持</li>
          </ul>
        </div>
      </div>
      <section className="login-panel">
        <div className="login-panel-inner">
          <span className="brand-kicker">WELCOME BACK</span>
          <div className="login-title">
            <h1>通用考勤系统</h1>
            <p className="login-sub">输入访问密码，开始管理今天的出勤</p>
          </div>
          <p className="login-date">{todayLabel()}</p>
          <form onSubmit={submit}>
            <label htmlFor="password">访问密码</label>
            <div className="password-input">
              <KeyRound size={18} />
              <input
                id="password"
                type={visible ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
                autoFocus
                required
              />
              <IconButton label={visible ? '隐藏密码' : '显示密码'} type="button" onClick={() => setVisible(!visible)}>
                {visible ? <EyeOff size={18} /> : <Eye size={18} />}
              </IconButton>
            </div>
            <button className="primary-button login-button" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}
              进入系统
            </button>
          </form>
          <span className="login-footnote"><ShieldCheck size={13} />MIT 开源 · 自托管部署 · 数据保存在你自己的服务器</span>
        </div>
      </section>
    </main>
  )
}

function MembersPage({ notify, refreshMembers }) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ member_no: '', name: '', enrollment_year: '', email: '' })
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [yearFilter, setYearFilter] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setMembers(await api('/api/members?include_inactive=true'))
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    load()
  }, [load])

  const years = useMemo(
    () => Array.from(new Set(members.map((m) => m.enrollment_year).filter(Boolean))).sort().reverse(),
    [members],
  )
  const visibleMembers = useMemo(
    () => (yearFilter === 'all' ? members : members.filter((m) => m.enrollment_year === yearFilter)),
    [members, yearFilter],
  )

  const addMember = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      await api('/api/members', { method: 'POST', body: JSON.stringify(form) })
      setForm({ member_no: '', name: '', enrollment_year: form.enrollment_year, email: '' })
      notify('成员已添加')
      await load()
      refreshMembers()
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = async () => {
    try {
      await api(`/api/members/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          member_no: editing.member_no,
          name: editing.name,
          enrollment_year: editing.enrollment_year || '',
          email: editing.email || '',
        }),
      })
      setEditing(null)
      notify('成员资料已更新')
      await load()
      refreshMembers()
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  const toggleActive = async (member) => {
    try {
      await api(`/api/members/${member.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !member.active }),
      })
      notify(member.active ? '成员已停用' : '成员已恢复')
      await load()
      refreshMembers()
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div><span className="eyebrow">MEMBERS</span><h1>成员管理</h1></div>
        <IconButton label="刷新成员列表" onClick={load}><RefreshCw size={17} /></IconButton>
      </section>

      <section className="tool-surface members-form-surface">
        <div className="surface-title"><div><h2>添加成员</h2><span>届别与邮箱选填，邮箱用于接收月度报告</span></div></div>
        <form className="member-add-form" onSubmit={addMember}>
          <div className="field">
            <label htmlFor="new-member-no">成员编号</label>
            <input id="new-member-no" value={form.member_no} onChange={(e) => setForm({ ...form, member_no: e.target.value })} placeholder="例如 A001" required />
          </div>
          <div className="field">
            <label htmlFor="new-member-name">姓名</label>
            <input id="new-member-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="成员姓名" required />
          </div>
          <div className="field">
            <label htmlFor="new-member-year">届别（选填）</label>
            <input id="new-member-year" value={form.enrollment_year} onChange={(e) => setForm({ ...form, enrollment_year: e.target.value })} placeholder="如 26-27" />
          </div>
          <div className="field">
            <label htmlFor="new-member-email">邮箱（选填）</label>
            <input id="new-member-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="用于接收月度报告" />
          </div>
          <button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Plus size={18} />}添加成员</button>
        </form>
      </section>

      <section className="tool-surface members-roster-surface">
        <div className="surface-title">
          <div><h2>成员名册</h2><span>共 {members.length} 名成员</span></div>
        </div>
        {years.length > 0 && (
          <div className="member-year-filter">
            <button className={yearFilter === 'all' ? 'active' : ''} onClick={() => setYearFilter('all')}>全部</button>
            {years.map((year) => (
              <button key={year} className={yearFilter === year ? 'active' : ''} onClick={() => setYearFilter(year)}>{year}</button>
            ))}
          </div>
        )}
        {loading ? (
          <Spinner />
        ) : visibleMembers.length === 0 ? (
          <EmptyState icon={UsersRound} title="尚无成员" detail={yearFilter === 'all' ? '在上方添加第一位成员' : '该届别暂无成员'} />
        ) : (
          <div className="member-list">
            {visibleMembers.map((member) => {
              const isEditing = editing?.id === member.id
              return (
                <div className={classNames('member-row', !member.active && 'member-inactive')} key={member.id}>
                  {isEditing ? (
                    <div className="member-edit-fields">
                      <input aria-label="成员编号" value={editing.member_no} onChange={(e) => setEditing({ ...editing, member_no: e.target.value })} placeholder="编号" />
                      <input aria-label="姓名" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="姓名" />
                      <input aria-label="届别" value={editing.enrollment_year || ''} onChange={(e) => setEditing({ ...editing, enrollment_year: e.target.value })} placeholder="届别 如 26-27" />
                      <input aria-label="邮箱" type="email" value={editing.email || ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} placeholder="邮箱" />
                    </div>
                  ) : (
                    <div className="member-identity">
                      <span className="member-avatar">{member.name.slice(0, 1)}</span>
                      <div className="member-identity-copy">
                        <strong>{member.name}
                          {member.enrollment_year && <span className="member-year-badge">{member.enrollment_year}</span>}
                          {!member.active && <span className="member-inactive-badge">已停用</span>}
                        </strong>
                        <span>{member.member_no}{member.email ? ` · ${member.email}` : ' · 未填邮箱'}</span>
                      </div>
                    </div>
                  )}
                  <div className="member-actions">
                    {isEditing ? (
                      <>
                        <IconButton label="保存" className="success-icon" onClick={saveEdit}><Check size={17} /></IconButton>
                        <IconButton label="取消" onClick={() => setEditing(null)}><X size={17} /></IconButton>
                      </>
                    ) : (
                      <>
                        <IconButton label="编辑成员" onClick={() => setEditing({ ...member })}><Edit3 size={16} /></IconButton>
                        <button className="text-button" onClick={() => toggleActive(member)}>{member.active ? '停用' : '恢复'}</button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

function AttendancePage({ members, onManageMembers, notify }) {
  const [dateValue, setDateValue] = useState(localDateValue())
  const [form, setForm] = useState({ member_no: '', minutes: 120, action: 'credit', note: '' })
  const [summary, setSummary] = useState({ attendance_count: 0, credited_minutes: 0, deducted_minutes: 0 })
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [summaryData, recordData] = await Promise.all([
        api(`/api/attendance/day-summary?training_date=${dateValue}`),
        api(`/api/attendance?training_date=${dateValue}&limit=100`),
      ])
      setSummary(summaryData)
      setRecords(recordData)
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [dateValue, notify])

  useEffect(() => {
    load()
  }, [load])

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      await api('/api/attendance', {
        method: 'POST',
        body: JSON.stringify({ ...form, training_date: dateValue }),
      })
      notify(form.action === 'credit' ? '签到记录已保存' : '扣除时长已保存')
      setForm((current) => ({ ...current, member_no: '', note: '' }))
      await load()
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const removeRecord = async (record) => {
    if (!window.confirm(`确认撤销 ${record.name} 的这条记录？`)) return
    try {
      await api(`/api/attendance/${record.id}`, { method: 'DELETE' })
      notify('记录已撤销')
      await load()
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div><span className="eyebrow">ATTENDANCE</span><h1>出勤签到</h1></div>
        <button className="secondary-button" onClick={onManageMembers}>
          <UsersRound size={17} />成员管理
        </button>
      </section>

      <section className="daily-summary">
        <div><span>当日签到人数</span><strong>{summary.attendance_count}</strong><small>人</small></div>
        <div><span>累计出勤时长</span><strong>{Number((summary.credited_minutes / 60).toFixed(1))}</strong><small>小时</small></div>
        <div><span>当日扣除时长</span><strong>{Number((summary.deducted_minutes / 60).toFixed(1))}</strong><small>小时</small></div>
        <label className="summary-date">
          <CalendarDays size={18} />
          <input type="date" value={dateValue} onChange={(event) => setDateValue(event.target.value)} />
        </label>
      </section>

      <div className="attendance-layout">
        <form className="tool-surface attendance-form" onSubmit={submit}>
          <div className="surface-title"><h2>登记记录</h2><span>{formatShortDate(dateValue)}</span></div>
          <div className="segmented-control" role="group" aria-label="记录类型">
            <button
              type="button"
              className={form.action === 'credit' ? 'active' : ''}
              onClick={() => setForm({ ...form, action: 'credit' })}
            ><CirclePlus size={17} />增加时长</button>
            <button
              type="button"
              className={form.action === 'deduction' ? 'active danger' : ''}
              onClick={() => setForm({ ...form, action: 'deduction' })}
            ><CircleMinus size={17} />扣除时长</button>
          </div>
          <div className="field">
            <label htmlFor="attendance-member">成员编号</label>
            <MemberPicker
              id="attendance-member"
              value={form.member_no}
              onChange={(value) => setForm({ ...form, member_no: value })}
              members={members}
              autoFocus
            />
          </div>
          <div className="field">
            <label>出勤时长</label>
            <DurationControl minutes={form.minutes} onChange={(minutes) => setForm({ ...form, minutes })} />
          </div>
          <div className="field">
            <label htmlFor="attendance-note">备注</label>
            <input
              id="attendance-note"
              value={form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
              placeholder="选填"
            />
          </div>
          <button className={classNames('primary-button submit-button', form.action === 'deduction' && 'danger-button')} disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}
            {form.action === 'credit' ? '确认签到' : '确认扣除'}
          </button>
        </form>

        <section className="tool-surface records-surface">
          <div className="surface-title">
            <div><h2>当日记录</h2><span>{records.length} 条</span></div>
            <IconButton label="刷新记录" onClick={load}><RefreshCw size={17} /></IconButton>
          </div>
          {loading ? <Spinner /> : records.length === 0 ? (
            <EmptyState icon={CalendarDays} title="当日暂无记录" />
          ) : (
            <div className="record-list">
              {records.map((record) => (
                <div className="record-item" key={record.id}>
                  <span className={classNames('record-marker', record.action === 'deduction' && 'deduction')} />
                  <div className="record-main">
                    <strong>{record.name}<small>{record.member_no}</small></strong>
                    <span>{record.note || (record.action === 'credit' ? '出勤签到' : '时长扣除')}</span>
                  </div>
                  <div className={classNames('record-duration', record.action === 'deduction' && 'negative')}>
                    {record.action === 'credit' ? '+' : '−'}{formatMinutes(record.minutes)}
                  </div>
                  <IconButton label="撤销记录" className="row-delete" onClick={() => removeRecord(record)}>
                    <Trash2 size={16} />
                  </IconButton>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function RankingPage({ members, onManageMembers, notify }) {
  const monthNow = currentMonthValue()
  const [scope, setScope] = useState('all')
  const [month, setMonth] = useState(monthNow)
  const [ranking, setRanking] = useState([])
  const [plans, setPlans] = useState([])
  const [planForm, setPlanForm] = useState({ month: monthNow, hours: '', note: '' })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const query = scope === 'month' ? `?month=${month}` : ''
      const [rankingData, planData] = await Promise.all([
        api(`/api/analytics/ranking${query}`),
        api('/api/training-plans'),
      ])
      setRanking(rankingData.members)
      setPlans(planData)
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [month, notify, scope])

  useEffect(() => { load() }, [load])

  const savePlan = async (event) => {
    event.preventDefault()
    const hours = Number(planForm.hours)
    if (!Number.isFinite(hours) || hours < 0) {
      notify('请输入有效的计划时长', 'error')
      return
    }
    setBusy(true)
    try {
      await api(`/api/training-plans/${planForm.month}`, {
        method: 'PUT',
        body: JSON.stringify({ planned_minutes: Math.round(hours * 60), note: planForm.note }),
      })
      notify('月度出勤计划已保存')
      await load()
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const editPlan = (plan) => setPlanForm({
    month: plan.month,
    hours: String(Number((plan.planned_minutes / 60).toFixed(1))),
    note: plan.note,
  })

  const totalNet = ranking.reduce((sum, member) => sum + member.net_minutes, 0)

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div><span className="eyebrow">HOURS RANKING</span><h1>出勤时长排行</h1></div>
        <button className="secondary-button" onClick={onManageMembers}><UsersRound size={17} />成员管理</button>
      </section>

      <div className="ranking-toolbar">
        <div className="segmented-control compact">
          <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>全部时间</button>
          <button className={scope === 'month' ? 'active' : ''} onClick={() => setScope('month')}>按月查看</button>
        </div>
        {scope === 'month' && <input className="month-input" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />}
        <span className="toolbar-total"><Clock3 size={16} />合计 {formatMinutes(totalNet)}</span>
      </div>

      <div className="ranking-layout">
        <section className="tool-surface ranking-surface">
          <div className="surface-title"><div><h2>{scope === 'all' ? '总榜' : formatMonth(month)}</h2><span>{ranking.length} 名成员</span></div></div>
          {loading ? <Spinner /> : ranking.length === 0 ? (
            <EmptyState icon={Trophy} title="暂无排行数据" detail="添加成员并录入签到后显示" />
          ) : (
            <div className="ranking-list">
              {ranking.map((member) => (
                <div className={classNames('ranking-row', member.rank <= 3 && `rank-${member.rank}`)} key={member.id}>
                  <span className="rank-number">{member.rank <= 3 ? <Medal size={20} /> : member.rank}</span>
                  <div className="rank-person"><strong>{member.name}</strong><span>{member.member_no}</span></div>
                  <div className="rank-hours"><strong>{formatMinutes(member.net_minutes)}</strong><span>净出勤时长</span></div>
                  <div className="rank-breakdown">
                    <span>累计 {formatMinutes(member.credited_minutes)}</span>
                    <span>扣除 {formatMinutes(member.deducted_minutes)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="tool-surface plan-surface">
          <div className="surface-title"><div><h2>月度出勤计划</h2><span>出勤率计算基准</span></div></div>
          <form className="plan-form" onSubmit={savePlan}>
            <div className="two-fields">
              <div className="field"><label htmlFor="plan-month">月份</label><input id="plan-month" type="month" value={planForm.month} onChange={(event) => setPlanForm({ ...planForm, month: event.target.value })} required /></div>
              <div className="field"><label htmlFor="plan-hours">计划时长</label><div className="input-suffix"><input id="plan-hours" type="number" min="0" step="0.5" value={planForm.hours} onChange={(event) => setPlanForm({ ...planForm, hours: event.target.value })} placeholder="0" required /><span>小时</span></div></div>
            </div>
            <div className="field"><label htmlFor="plan-note">备注</label><input id="plan-note" value={planForm.note} onChange={(event) => setPlanForm({ ...planForm, note: event.target.value })} placeholder="选填" /></div>
            <button className="primary-button full-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}保存计划</button>
          </form>
          <div className="plan-history">
            {plans.length === 0 ? <EmptyState icon={CalendarDays} title="暂无出勤计划" /> : plans.map((plan) => (
              <button className="plan-row" key={plan.id} onClick={() => editPlan(plan)}>
                <span className="plan-month"><CalendarDays size={17} />{formatMonth(plan.month)}</span>
                <strong>{formatMinutes(plan.planned_minutes)}</strong>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}

function AssessmentPage({ members, notify }) {
  const today = localDateValue()
  const [tab, setTab] = useState('exams')
  const [exams, setExams] = useState([])
  const [violations, setViolations] = useState([])
  const [examForm, setExamForm] = useState({ exam_name: '', member_no: '', project: '', score: '', exam_date: today, note: '' })
  const [violationForm, setViolationForm] = useState({ member_no: '', behavior: '', deducted_minutes: 30, violation_date: today, note: '' })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [examData, violationData] = await Promise.all([api('/api/exams'), api('/api/violations')])
      setExams(examData)
      setViolations(violationData)
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => { load() }, [load])

  const submitExam = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      await api('/api/exams', { method: 'POST', body: JSON.stringify({ ...examForm, score: Number(examForm.score) }) })
      notify('考试分数已保存')
      setExamForm((form) => ({ ...form, member_no: '', score: '', note: '' }))
      await load()
    } catch (error) {
      notify(error.message, 'error')
    } finally { setBusy(false) }
  }

  const submitViolation = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      await api('/api/violations', { method: 'POST', body: JSON.stringify(violationForm) })
      notify('违规记录已保存并计入扣时')
      setViolationForm((form) => ({ ...form, member_no: '', behavior: '', note: '' }))
      await load()
    } catch (error) {
      notify(error.message, 'error')
    } finally { setBusy(false) }
  }

  const remove = async (kind, record) => {
    if (!window.confirm('确认撤销这条记录？')) return
    try {
      await api(`/api/${kind}/${record.id}`, { method: 'DELETE' })
      notify('记录已撤销')
      await load()
    } catch (error) { notify(error.message, 'error') }
  }

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div><span className="eyebrow">ASSESSMENT</span><h1>考核与纪律</h1></div>
      </section>
      <div className="page-tabs">
        <button className={tab === 'exams' ? 'active' : ''} onClick={() => setTab('exams')}><BookOpenCheck size={18} />考试分数<span>{exams.length}</span></button>
        <button className={tab === 'violations' ? 'active' : ''} onClick={() => setTab('violations')}><AlertTriangle size={18} />违规<span>{violations.length}</span></button>
      </div>

      {tab === 'exams' ? (
        <div className="assessment-layout">
          <form className="tool-surface assessment-form" onSubmit={submitExam}>
            <div className="surface-title"><div><h2>录入考试分数</h2><span>{formatShortDate(examForm.exam_date)}</span></div></div>
            <div className="field"><label htmlFor="exam-name">考试名称</label><input id="exam-name" value={examForm.exam_name} onChange={(event) => setExamForm({ ...examForm, exam_name: event.target.value })} placeholder="例如：九月月度考核" required /></div>
            <div className="field"><label htmlFor="exam-member">成员编号</label><MemberPicker id="exam-member" value={examForm.member_no} onChange={(value) => setExamForm({ ...examForm, member_no: value })} members={members} /></div>
            <div className="two-fields">
              <div className="field"><label htmlFor="exam-project">考核项目</label><input id="exam-project" value={examForm.project} onChange={(event) => setExamForm({ ...examForm, project: event.target.value })} placeholder="项目名称" required /></div>
              <div className="field"><label htmlFor="exam-score">分数</label><div className="input-suffix"><input id="exam-score" type="number" min="0" max="100" step="0.1" value={examForm.score} onChange={(event) => setExamForm({ ...examForm, score: event.target.value })} placeholder="0" required /><span>分</span></div></div>
            </div>
            <div className="field"><label htmlFor="exam-date">考试日期</label><input id="exam-date" type="date" value={examForm.exam_date} onChange={(event) => setExamForm({ ...examForm, exam_date: event.target.value })} required /></div>
            <div className="field"><label htmlFor="exam-note">备注</label><input id="exam-note" value={examForm.note} onChange={(event) => setExamForm({ ...examForm, note: event.target.value })} placeholder="选填" /></div>
            <button className="primary-button full-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}保存分数</button>
          </form>
          <RecordTable type="exams" records={exams} loading={loading} onRefresh={load} onRemove={(record) => remove('exams', record)} />
        </div>
      ) : (
        <div className="assessment-layout">
          <form className="tool-surface assessment-form violation-form" onSubmit={submitViolation}>
            <div className="surface-title"><div><h2>录入违规</h2><span>{formatShortDate(violationForm.violation_date)}</span></div></div>
            <div className="field"><label htmlFor="violation-member">成员编号</label><MemberPicker id="violation-member" value={violationForm.member_no} onChange={(value) => setViolationForm({ ...violationForm, member_no: value })} members={members} /></div>
            <div className="field"><label htmlFor="violation-behavior">违规行为</label><input id="violation-behavior" value={violationForm.behavior} onChange={(event) => setViolationForm({ ...violationForm, behavior: event.target.value })} placeholder="填写违规行为" required /></div>
            <div className="field"><label>扣除时长</label><DurationControl max={360} minutes={violationForm.deducted_minutes} onChange={(deducted_minutes) => setViolationForm({ ...violationForm, deducted_minutes })} /></div>
            <div className="field"><label htmlFor="violation-date">发生日期</label><input id="violation-date" type="date" value={violationForm.violation_date} onChange={(event) => setViolationForm({ ...violationForm, violation_date: event.target.value })} required /></div>
            <div className="field"><label htmlFor="violation-note">备注</label><input id="violation-note" value={violationForm.note} onChange={(event) => setViolationForm({ ...violationForm, note: event.target.value })} placeholder="选填" /></div>
            <button className="primary-button danger-button full-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}保存并扣时</button>
          </form>
          <RecordTable type="violations" records={violations} loading={loading} onRefresh={load} onRemove={(record) => remove('violations', record)} />
        </div>
      )}
    </div>
  )
}

function RecordTable({ type, records, loading, onRefresh, onRemove }) {
  const isExam = type === 'exams'
  return (
    <section className="tool-surface records-table-surface">
      <div className="surface-title"><div><h2>{isExam ? '考试记录' : '违规记录'}</h2><span>最近 {records.length} 条</span></div><IconButton label="刷新记录" onClick={onRefresh}><RefreshCw size={17} /></IconButton></div>
      {loading ? <Spinner /> : records.length === 0 ? (
        <EmptyState icon={isExam ? BookOpenCheck : AlertTriangle} title={isExam ? '暂无考试记录' : '暂无违规记录'} />
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>成员</th><th>{isExam ? '考试 / 项目' : '违规行为'}</th><th>{isExam ? '分数' : '扣除'}</th><th>日期</th><th aria-label="操作" /></tr></thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td><strong>{record.name}</strong><small>{record.member_no}</small></td>
                  <td><strong>{isExam ? record.exam_name : record.behavior}</strong>{isExam && <small>{record.project}</small>}</td>
                  <td>{isExam ? <span className="score-pill">{Number(record.score.toFixed(1))}</span> : <span className="deduction-text">−{formatMinutes(record.deducted_minutes)}</span>}</td>
                  <td>{formatShortDate(isExam ? record.exam_date : record.violation_date)}</td>
                  <td><IconButton label="撤销记录" className="row-delete" onClick={() => onRemove(record)}><Trash2 size={16} /></IconButton></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function AnalyticsPage({ notify }) {
  const [month, setMonth] = useState(currentMonthValue())
  const [data, setData] = useState({ planned_minutes: 0, members: [] })
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api(`/api/analytics/attendance?month=${month}`))
    } catch (error) {
      notify(error.message, 'error')
    } finally { setLoading(false) }
  }, [month, notify])

  useEffect(() => { load() }, [load])

  const measured = data.members.filter((member) => member.attendance_rate !== null)
  const averageRate = measured.length ? measured.reduce((sum, member) => sum + member.attendance_rate, 0) / measured.length : null
  const scored = data.members.filter((member) => member.average_score !== null)
  const averageScore = scored.length ? scored.reduce((sum, member) => sum + member.average_score, 0) / scored.length : null

  const exportCsv = () => {
    const rows = [
      ['成员编号', '姓名', '累计出勤时长（小时）', '扣除时长（小时）', '净出勤时长（小时）', '出勤率', '平均考核分数'],
      ...data.members.map((member) => [
        member.member_no,
        member.name,
        (member.credited_minutes / 60).toFixed(2),
        (member.deducted_minutes / 60).toFixed(2),
        (member.net_minutes / 60).toFixed(2),
        member.attendance_rate === null ? '' : `${member.attendance_rate}%`,
        member.average_score === null ? '' : member.average_score.toFixed(1),
      ]),
    ]
    const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')}`
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    link.download = `出勤分析-${month}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <div className="page-stack analytics-page">
      <section className="page-heading analytics-heading">
        <div><span className="eyebrow">ANALYTICS</span><h1>出勤率分析</h1></div>
        <div className="heading-actions">
          <input className="month-input" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          <button className="secondary-button" onClick={exportCsv} disabled={!data.members.length}><Download size={17} />导出</button>
        </div>
      </section>

      <section className="analytics-summary">
        <div className="analytics-stat"><span className="summary-icon green"><Gauge size={20} /></span><div className="analytics-stat-copy"><span>平均出勤率</span><strong>{averageRate === null ? '—' : `${averageRate.toFixed(1)}%`}</strong></div></div>
        <div className="analytics-stat"><span className="summary-icon blue"><Clock3 size={20} /></span><div className="analytics-stat-copy"><span>本月计划时长</span><strong>{formatMinutes(data.planned_minutes)}</strong></div></div>
        <div className="analytics-stat"><span className="summary-icon gold"><BookOpenCheck size={20} /></span><div className="analytics-stat-copy"><span>平均考核分数</span><strong>{averageScore === null ? '—' : averageScore.toFixed(1)}</strong></div></div>
        <div className="analytics-stat"><span className="summary-icon red"><UsersRound size={20} /></span><div className="analytics-stat-copy"><span>成员人数</span><strong>{data.members.length}</strong></div></div>
      </section>

      <section className="tool-surface analytics-table-surface">
        <div className="surface-title"><div><h2>{formatMonth(month)}</h2><span>{data.plan_note || (data.planned_minutes ? '月度出勤汇总' : '尚未设置月度出勤计划')}</span></div><IconButton label="刷新分析" onClick={load}><RefreshCw size={17} /></IconButton></div>
        {loading ? <Spinner /> : data.members.length === 0 ? (
          <EmptyState icon={BarChart3} title="暂无成员数据" />
        ) : (
          <>
            <div className="data-table-wrap analytics-desktop-table">
              <table className="data-table analytics-table">
                <thead><tr><th>成员</th><th>累计出勤</th><th>扣除时长</th><th>净出勤</th><th>出勤率</th><th>考核分数</th></tr></thead>
                <tbody>
                  {data.members.map((member) => (
                    <tr key={member.id}>
                      <td><strong>{member.name}</strong><small>{member.member_no}</small></td>
                      <td>{formatMinutes(member.credited_minutes)}</td>
                      <td className="deduction-text">{member.deducted_minutes ? `−${formatMinutes(member.deducted_minutes)}` : '0 小时'}</td>
                      <td><strong>{formatMinutes(member.net_minutes)}</strong></td>
                      <td>
                        {member.attendance_rate === null ? <span className="muted">未设置计划</span> : (
                          <div className="rate-cell"><strong>{member.attendance_rate}%</strong><span className="progress-track"><span style={{ width: `${Math.min(100, member.attendance_rate)}%` }} /></span></div>
                        )}
                      </td>
                      <td>{member.average_score === null ? <span className="muted">暂无</span> : <><strong>{member.average_score.toFixed(1)}</strong><small>{member.exam_count} 项记录</small></>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="analytics-mobile-list">
              {data.members.map((member) => (
                <article className="analytics-member-row" key={member.id}>
                  <header>
                    <div className="analytics-member-identity">
                      <span className="analytics-member-avatar">{member.name.slice(0, 1)}</span>
                      <div><strong>{member.name}</strong><span>{member.member_no}</span></div>
                    </div>
                    {member.attendance_rate === null
                      ? <span className="rate-badge muted-rate">未设置计划</span>
                      : <span className="rate-badge">{member.attendance_rate}%</span>}
                  </header>
                  <div className="analytics-member-metrics">
                    <div><span>累计出勤</span><strong>{formatMinutes(member.credited_minutes)}</strong></div>
                    <div><span>扣除时长</span><strong className={member.deducted_minutes ? 'deduction-text' : ''}>{formatMinutes(member.deducted_minutes)}</strong></div>
                    <div><span>净出勤</span><strong>{formatMinutes(member.net_minutes)}</strong></div>
                    <div><span>考核分数</span><strong>{member.average_score === null ? '—' : member.average_score.toFixed(1)}</strong></div>
                  </div>
                  {member.attendance_rate !== null && (
                    <span className="progress-track mobile-progress"><span style={{ width: `${Math.min(100, member.attendance_rate)}%` }} /></span>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function LogsPage({ notify }) {
  const [tab, setTab] = useState('all')
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)

  const CATEGORY_MAP = { attendance: '签到', exam: '考核', violation: '违规' }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const query = tab === 'all' ? '' : `?category=${tab}`
      setLogs(await api(`/api/logs${query}`))
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [tab, notify])

  useEffect(() => { load() }, [load])

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div><span className="eyebrow">OPERATION LOGS</span><h1>操作日志</h1></div>
        <IconButton label="刷新日志" onClick={load}><RefreshCw size={17} /></IconButton>
      </section>

      <div className="page-tabs">
        <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
          <ScrollText size={18} />全部<span>{tab === 'all' ? logs.length : ''}</span>
        </button>
        <button className={tab === 'attendance' ? 'active' : ''} onClick={() => setTab('attendance')}>
          <ListChecks size={18} />签到
        </button>
        <button className={tab === 'exam' ? 'active' : ''} onClick={() => setTab('exam')}>
          <BookOpenCheck size={18} />考核
        </button>
        <button className={tab === 'violation' ? 'active' : ''} onClick={() => setTab('violation')}>
          <AlertTriangle size={18} />违规
        </button>
      </div>

      <section className="tool-surface logs-surface">
        <div className="surface-title">
          <div><h2>{tab === 'all' ? '全部日志' : `${CATEGORY_MAP[tab]}日志`}</h2><span>最近 {logs.length} 条</span></div>
        </div>
        {loading ? <Spinner /> : logs.length === 0 ? (
          <EmptyState icon={ScrollText} title="暂无操作日志" detail="进行签到、考核或违规操作后将自动记录" />
        ) : (
          <div className="data-table-wrap">
            <table className="data-table logs-table">
              <thead><tr><th>时间</th><th>分类</th><th>操作</th><th>详情</th><th>IP地址</th></tr></thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td><span className="log-time">{formatLogTime(log.created_at)}</span></td>
                    <td><span className={`log-category-badge log-cat-${log.category}`}>{CATEGORY_MAP[log.category]}</span></td>
                    <td><span className={`log-action-badge log-action-${log.action}`}>{log.action === 'add' ? '新增' : '删除'}</span></td>
                    <td className="log-detail-cell">{log.detail}</td>
                    <td><span className="log-ip">{log.operator_ip}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function PasswordModal({ onClose, notify }) {
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    if (form.new_password !== form.confirm) {
      notify('两次输入的新密码不一致', 'error')
      return
    }
    setBusy(true)
    try {
      const result = await api('/api/auth/password', {
        method: 'PUT',
        body: JSON.stringify({ current_password: form.current_password, new_password: form.new_password }),
      })
      notify(result.message)
      onClose()
    } catch (error) { notify(error.message, 'error') }
    finally { setBusy(false) }
  }
  return (
    <Modal title="修改访问密码" onClose={onClose}>
      <form className="modal-body password-form" onSubmit={submit}>
        <div className="field"><label htmlFor="current-password">当前密码</label><input id="current-password" type="password" value={form.current_password} onChange={(event) => setForm({ ...form, current_password: event.target.value })} required autoFocus /></div>
        <div className="field"><label htmlFor="new-password">新密码</label><input id="new-password" type="password" minLength="4" value={form.new_password} onChange={(event) => setForm({ ...form, new_password: event.target.value })} required /></div>
        <div className="field"><label htmlFor="confirm-password">确认新密码</label><input id="confirm-password" type="password" minLength="4" value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} required /></div>
        <button className="primary-button full-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <KeyRound size={17} />}更新密码</button>
      </form>
    </Modal>
  )
}

function EmailModal({ onClose, notify, members = [] }) {
  const [tab, setTab] = useState('settings')
  const [settings, setSettings] = useState(null)
  const [testTo, setTestTo] = useState('')
  const [month, setMonth] = useState(currentMonthValue())
  const [summary, setSummary] = useState(null)
  const [logs, setLogs] = useState([])
  const [logsLoaded, setLogsLoaded] = useState(false)
  const [busy, setBusy] = useState('')
  const [scope, setScope] = useState('all')
  const [selectedYears, setSelectedYears] = useState([])
  const [selectedIds, setSelectedIds] = useState([])

  const STATUS_LABEL = { sent: '已发送', failed: '失败', skipped: '跳过' }

  const years = useMemo(
    () => Array.from(new Set(members.map((m) => m.enrollment_year).filter(Boolean))).sort().reverse(),
    [members],
  )

  const targets = useMemo(() => {
    if (scope === 'year') return members.filter((m) => selectedYears.includes(m.enrollment_year))
    if (scope === 'custom') return members.filter((m) => selectedIds.includes(m.id))
    return members
  }, [scope, members, selectedYears, selectedIds])
  const targetsWithEmail = targets.filter((m) => m.email)

  const toggleYear = (year) =>
    setSelectedYears((prev) => (prev.includes(year) ? prev.filter((y) => y !== year) : [...prev, year]))
  const toggleId = (id) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const loadSettings = useCallback(async () => {
    try {
      const data = await api('/api/email/settings')
      setSettings({
        smtp_host: data.smtp_host || '',
        smtp_port: data.smtp_port || 465,
        smtp_username: data.smtp_username || '',
        smtp_password: '',
        password_set: data.password_set,
        sender_name: data.sender_name || 'RollCall',
        from_email: data.from_email || '',
        use_ssl: data.use_ssl,
        auto_enabled: data.auto_enabled,
        last_sent_month: data.last_sent_month || '',
      })
    } catch (error) { notify(error.message, 'error') }
  }, [notify])

  useEffect(() => { loadSettings() }, [loadSettings])

  const loadLogs = useCallback(async () => {
    try { setLogs(await api('/api/email/logs')); setLogsLoaded(true) }
    catch (error) { notify(error.message, 'error') }
  }, [notify])

  useEffect(() => { if (tab === 'logs' && !logsLoaded) loadLogs() }, [tab, logsLoaded, loadLogs])

  const patch = (changes) => setSettings((prev) => ({ ...prev, ...changes }))

  const saveSettings = async (event) => {
    event.preventDefault()
    setBusy('save')
    try {
      const body = {
        smtp_host: settings.smtp_host,
        smtp_port: Number(settings.smtp_port),
        smtp_username: settings.smtp_username,
        sender_name: settings.sender_name,
        from_email: settings.from_email,
        use_ssl: settings.use_ssl,
        auto_enabled: settings.auto_enabled,
      }
      if (settings.smtp_password) body.smtp_password = settings.smtp_password
      await api('/api/email/settings', { method: 'PUT', body: JSON.stringify(body) })
      notify('邮件设置已保存')
      await loadSettings()
    } catch (error) { notify(error.message, 'error') }
    finally { setBusy('') }
  }

  const sendTest = async () => {
    if (!testTo.trim()) { notify('请填写测试收件邮箱', 'error'); return }
    setBusy('test')
    try {
      const result = await api('/api/email/test', { method: 'POST', body: JSON.stringify({ to_email: testTo.trim() }) })
      notify(result.message)
    } catch (error) { notify(error.message, 'error') }
    finally { setBusy('') }
  }

  const sendReports = async () => {
    if (scope !== 'all' && targets.length === 0) { notify('请先选择要推送的成员或届别', 'error'); return }
    if (targetsWithEmail.length === 0) { notify('所选范围内没有填写邮箱的成员', 'error'); return }
    setBusy('send')
    setSummary(null)
    try {
      const body = { month }
      if (scope !== 'all') body.member_ids = targets.map((m) => m.id)
      const result = await api('/api/email/send', { method: 'POST', body: JSON.stringify(body) })
      setSummary(result)
      notify(`推送完成：成功 ${result.sent} · 跳过 ${result.skipped} · 失败 ${result.failed}`)
      setLogsLoaded(false)
    } catch (error) { notify(error.message, 'error') }
    finally { setBusy('') }
  }

  return (
    <Modal title="邮件推送" onClose={onClose} size="wide">
      <div className="modal-body email-modal">
        <div className="page-tabs email-tabs">
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}><Settings2 size={17} />SMTP 设置</button>
          <button className={tab === 'send' ? 'active' : ''} onClick={() => setTab('send')}><Send size={17} />发送报告</button>
          <button className={tab === 'logs' ? 'active' : ''} onClick={() => setTab('logs')}><ScrollText size={17} />发送记录</button>
        </div>

        {tab === 'settings' && (settings === null ? <Spinner /> : (
          <form className="email-settings-form" onSubmit={saveSettings}>
            <div className="email-form-grid">
              <div className="field"><label>SMTP 服务器</label><input value={settings.smtp_host} onChange={(e) => patch({ smtp_host: e.target.value })} placeholder="例如 smtp.qq.com" /></div>
              <div className="field"><label>端口</label><input type="number" value={settings.smtp_port} onChange={(e) => patch({ smtp_port: e.target.value })} placeholder="465 / 587" /></div>
              <div className="field"><label>用户名</label><input value={settings.smtp_username} onChange={(e) => patch({ smtp_username: e.target.value })} placeholder="登录邮箱账号" /></div>
              <div className="field"><label>密码 / 授权码{settings.password_set && <span className="field-hint">（已保存，留空则不修改）</span>}</label><input type="password" value={settings.smtp_password} onChange={(e) => patch({ smtp_password: e.target.value })} placeholder={settings.password_set ? '••••••' : '邮箱授权码'} /></div>
              <div className="field"><label>发件人名称</label><input value={settings.sender_name} onChange={(e) => patch({ sender_name: e.target.value })} placeholder="例如：考勤助手" /></div>
              <div className="field"><label>发件邮箱</label><input type="email" value={settings.from_email} onChange={(e) => patch({ from_email: e.target.value })} placeholder="留空则使用用户名" /></div>
            </div>
            <div className="email-toggles">
              <label className="email-check"><input type="checkbox" checked={settings.use_ssl} onChange={(e) => patch({ use_ssl: e.target.checked })} /><span>使用 SSL（465 端口勾选；587 端口取消）</span></label>
              <label className="email-check"><input type="checkbox" checked={settings.auto_enabled} onChange={(e) => patch({ auto_enabled: e.target.checked })} /><span>每月最后一天自动推送</span></label>
            </div>
            <p className="email-note"><AlertTriangle size={15} />定时推送仅在本程序（start.bat）运行期间生效，关闭后不会发送。</p>
            <div className="email-actions">
              <button type="submit" className="primary-button" disabled={busy === 'save'}>{busy === 'save' ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}保存设置</button>
              <div className="email-test-row">
                <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="测试收件邮箱" />
                <button type="button" className="secondary-button" onClick={sendTest} disabled={busy === 'test'}>{busy === 'test' ? <LoaderCircle className="spin" size={17} /> : <MailCheck size={17} />}发送测试</button>
              </div>
            </div>
          </form>
        ))}

        {tab === 'send' && (
          <div className="email-send-pane">
            <div className="email-send-head">
              <div className="field"><label>报告月份</label><input className="month-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
              <button className="primary-button" onClick={sendReports} disabled={busy === 'send'}>{busy === 'send' ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}推送报告</button>
            </div>

            <div className="email-scope">
              <div className="segmented">
                <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>全员</button>
                <button className={scope === 'year' ? 'active' : ''} onClick={() => setScope('year')} disabled={years.length === 0}>按届别</button>
                <button className={scope === 'custom' ? 'active' : ''} onClick={() => setScope('custom')}>指定成员</button>
              </div>

              {scope === 'year' && (
                years.length === 0 ? (
                  <p className="email-scope-empty">尚无成员填写届别，请先在「成员管理」中设置。</p>
                ) : (
                  <div className="email-year-chips">
                    {years.map((year) => (
                      <button key={year} className={selectedYears.includes(year) ? 'active' : ''} onClick={() => toggleYear(year)}>{year}</button>
                    ))}
                  </div>
                )
              )}

              {scope === 'custom' && (
                members.length === 0 ? (
                  <p className="email-scope-empty">尚无成员。</p>
                ) : (
                  <div className="email-member-picker">
                    {members.map((m) => (
                      <label key={m.id} className={classNames('email-member-option', !m.email && 'no-email')}>
                        <input type="checkbox" checked={selectedIds.includes(m.id)} onChange={() => toggleId(m.id)} />
                        <span className="opt-name">{m.name}<small>{m.member_no}{m.enrollment_year ? ` · ${m.enrollment_year}` : ''}</small></span>
                        <span className="opt-mail">{m.email || '无邮箱'}</span>
                      </label>
                    ))}
                  </div>
                )
              )}
            </div>

            <p className="email-note"><Mail size={15} />将向所选范围内 <strong>{targetsWithEmail.length}</strong> 位已填邮箱的成员发送该月个人报告（共选中 {targets.length} 人）。</p>
            {summary && (
              <div className="email-summary">
                <div className="email-summary-stats">
                  <div className="email-stat sent"><strong>{summary.sent}</strong><span>成功</span></div>
                  <div className="email-stat skipped"><strong>{summary.skipped}</strong><span>跳过</span></div>
                  <div className="email-stat failed"><strong>{summary.failed}</strong><span>失败</span></div>
                </div>
                {summary.details.length > 0 && (
                  <ul className="email-detail-list">
                    {summary.details.map((item, index) => (
                      <li key={index} className={`detail-${item.status}`}><span>{item.name}</span><span className="detail-reason">{STATUS_LABEL[item.status]}{item.reason ? ` · ${item.reason}` : ''}</span></li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'logs' && (
          <div className="email-logs-pane">
            <div className="member-list-head"><span>最近 {logs.length} 条</span><IconButton label="刷新记录" onClick={loadLogs}><RefreshCw size={17} /></IconButton></div>
            {!logsLoaded ? <Spinner /> : logs.length === 0 ? (
              <EmptyState icon={Mail} title="暂无发送记录" detail="推送月度报告后将在此显示" />
            ) : (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead><tr><th>时间</th><th>月份</th><th>收件人</th><th>状态</th><th>备注</th></tr></thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id}>
                        <td><span className="log-time">{formatLogTime(log.created_at)}</span></td>
                        <td>{log.month}</td>
                        <td>{log.recipient || '—'}</td>
                        <td><span className={`email-status-badge status-${log.status}`}>{STATUS_LABEL[log.status]}</span></td>
                        <td className="log-detail-cell">{log.error || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function AppShell({ onLogout, notify }) {
  const [activePage, setActivePage] = useState('attendance')
  const [menuOpen, setMenuOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [members, setMembers] = useState([])

  const loadMembers = useCallback(async () => {
    try { setMembers(await api('/api/members')) }
    catch (error) { notify(error.message, 'error') }
  }, [notify])

  useEffect(() => { loadMembers() }, [loadMembers])

  const pageMeta = navItems.find((item) => item.id === activePage)
  const pageTitle = activePage === 'members' ? '成员管理' : pageMeta?.label
  const navigate = (id) => { setActivePage(id); setMenuOpen(false) }

  return (
    <div className="app-shell">
      <aside className={classNames('sidebar', menuOpen && 'sidebar-open')}>
        <div className="sidebar-brand">
          <img src="/assets/logo.svg" alt="RollCall Logo" />
          <div><strong>RollCall</strong><span>GENERIC ATTENDANCE</span></div>
          <IconButton label="关闭菜单" className="sidebar-close" onClick={() => setMenuOpen(false)}><X size={19} /></IconButton>
        </div>
        <nav>
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} className={activePage === id ? 'active' : ''} aria-current={activePage === id ? 'page' : undefined} onClick={() => navigate(id)}>
              <Icon size={19} /><span>{label}</span>{activePage === id && <ChevronRight className="nav-arrow" size={16} />}
            </button>
          ))}
          <button className={activePage === 'members' ? 'active' : ''} aria-current={activePage === 'members' ? 'page' : undefined} onClick={() => navigate('members')}>
            <UsersRound size={19} /><span>成员管理</span>{activePage === 'members' && <ChevronRight className="nav-arrow" size={16} />}
          </button>
        </nav>
        <div className="sidebar-footer">
          <button onClick={() => { setEmailOpen(true); setMenuOpen(false) }}><Mail size={18} />邮件推送</button>
          <button onClick={() => setPasswordOpen(true)}><Settings2 size={18} />修改密码</button>
          <button onClick={onLogout}><LogOut size={18} />退出系统</button>
        </div>
      </aside>

      {menuOpen && <button className="sidebar-scrim" aria-label="关闭菜单" onClick={() => setMenuOpen(false)} />}

      <div className="app-main">
        <header className="topbar">
          <IconButton label="打开菜单" className="menu-button" onClick={() => setMenuOpen(true)}><Menu size={20} /></IconButton>
          <div><strong>{pageTitle}</strong><span>{todayLabel()}</span></div>
          <button className="topbar-security" onClick={() => setPasswordOpen(true)}><ShieldCheck size={17} />本地数据已连接</button>
        </header>
        <main className="page-content">
          {activePage === 'attendance' && <AttendancePage members={members} onManageMembers={() => navigate('members')} notify={notify} />}
          {activePage === 'ranking' && <RankingPage members={members} onManageMembers={() => navigate('members')} notify={notify} />}
          {activePage === 'records' && <AssessmentPage members={members} notify={notify} />}
          {activePage === 'analytics' && <AnalyticsPage notify={notify} />}
          {activePage === 'logs' && <LogsPage notify={notify} />}
          {activePage === 'members' && <MembersPage notify={notify} refreshMembers={loadMembers} />}
        </main>
      </div>

      <nav className="mobile-nav">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button key={id} className={activePage === id ? 'active' : ''} aria-current={activePage === id ? 'page' : undefined} onClick={() => navigate(id)}>
            <Icon size={20} /><span>{label}</span>
          </button>
        ))}
      </nav>
      {passwordOpen && <PasswordModal onClose={() => setPasswordOpen(false)} notify={notify} />}
      {emailOpen && <EmailModal onClose={() => setEmailOpen(false)} notify={notify} members={members} />}
    </div>
  )
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(false)
  const [checking, setChecking] = useState(Boolean(getToken()))
  const [toast, setToastState] = useState(null)

  const notify = useCallback((message, type = 'success') => {
    setToastState({ message, type, id: Date.now() })
  }, [])

  useEffect(() => {
    const expire = () => setAuthenticated(false)
    window.addEventListener('auth-expired', expire)
    if (!getToken()) return () => window.removeEventListener('auth-expired', expire)
    api('/api/auth/verify')
      .then(() => setAuthenticated(true))
      .catch(() => setAuthenticated(false))
      .finally(() => setChecking(false))
    return () => window.removeEventListener('auth-expired', expire)
  }, [])

  const logout = () => {
    setToken(null)
    setAuthenticated(false)
  }

  if (checking) {
    return <div className="app-loading"><img src="/assets/logo.svg" alt="" /><LoaderCircle className="spin" size={24} /></div>
  }

  return (
    <>
      {authenticated ? <AppShell onLogout={logout} notify={notify} /> : <LoginScreen onLogin={() => setAuthenticated(true)} notify={notify} />}
      <Toast toast={toast} onClose={() => setToastState(null)} />
    </>
  )
}
