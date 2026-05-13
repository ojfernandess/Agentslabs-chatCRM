import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { MessageSquare, Users, Bell, BarChart3, TrendingUp, PieChart, ArrowRight, PauseCircle } from "lucide-react";
import { PageTransition, motion, staggerContainer, staggerItem } from "@/components/Motion";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area, PieChart as RePieChart, Pie, Cell, Legend
} from "recharts";
import { formatDistanceToNow } from "date-fns";
import { useI18n } from "@/i18n/I18nProvider";

interface DashboardData {
  stats: {
    openConversations: number;
    pendingConversations: number;
    totalContacts: number;
    remindersDueToday: number;
  };
  pipeline: { name: string; value: number }[];
  tags: { name: string; value: number }[];
  messageVolume: { name: string; inbound: number; outbound: number }[];
  recentConversations: {
    id: string;
    contactName: string;
    phone: string;
    lastMessage: string;
    time: string;
  }[];
}

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));
  const { t, dateLocale } = useI18n();

  useEffect(() => {
    async function loadDashboard() {
      try {
        const response = await api.get<DashboardData>("/dashboard");
        setData(response);
      } catch (err) {
        console.error("Failed to load dashboard data", err);
      } finally {
        setLoading(false);
      }
    }
    loadDashboard();
  }, []);

  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setIsDark(el.classList.contains("dark")));
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  const inkSubtle = isDark ? "rgba(255,255,255,0.10)" : "#f3f4f6";
  const axisTick = isDark ? "rgba(226,232,240,0.85)" : "#9ca3af";
  const axisTickStrong = isDark ? "rgba(226,232,240,0.92)" : "#4b5563";
  const tooltipStyle = {
    borderRadius: "12px",
    border: isDark ? "1px solid rgba(255,255,255,0.10)" : "1px solid rgba(0,0,0,0.06)",
    backgroundColor: isDark ? "rgba(17, 28, 43, 0.95)" : "rgba(255,255,255,0.98)",
    color: isDark ? "rgba(241,245,249,0.96)" : "rgba(17,24,39,0.92)",
    boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.18)",
  } as const;

  const statCards = [
    {
      labelKey: "dashboard.openConversations",
      value: data?.stats.openConversations ?? 0,
      icon: MessageSquare,
      color: "text-blue-600 bg-blue-50 dark:text-blue-300 dark:bg-blue-500/10",
      link: "/conversations?status=OPEN",
    },
    {
      labelKey: "dashboard.pendingConversations",
      value: data?.stats.pendingConversations ?? 0,
      icon: PauseCircle,
      color: "text-amber-600 bg-amber-50 dark:text-amber-300 dark:bg-amber-500/10",
      link: "/conversations?status=PENDING",
    },
    {
      labelKey: "dashboard.totalContacts",
      value: data?.stats.totalContacts ?? 0,
      icon: Users,
      color: "text-green-600 bg-green-50 dark:text-green-300 dark:bg-green-500/10",
      link: "/contacts",
    },
    {
      labelKey: "dashboard.remindersToday",
      value: data?.stats.remindersDueToday ?? 0,
      icon: Bell,
      color: "text-violet-600 bg-violet-50 dark:text-violet-300 dark:bg-violet-500/10",
      link: "/reminders",
    },
  ];

  return (
    <PageTransition>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-ink-900 dark:text-ink-50">{t("dashboard.title")}</h1>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{t("dashboard.subtitle")}</p>
        </div>

        {/* Top Stats */}
        <motion.div
          className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4"
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          {statCards.map((card) => (
            <motion.div key={card.labelKey} variants={staggerItem}>
              <Link
                to={card.link}
                className="card-surface block rounded-xl p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-md dark:bg-ink-900/80"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-xl ${card.color}`}
                  >
                    <card.icon className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-ink-500 dark:text-ink-400">{t(card.labelKey)}</p>
                    <p className="text-2xl font-bold text-ink-900 dark:text-ink-50">
                      {card.value}
                    </p>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </motion.div>

        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Message Volume Area Chart - Spans 2 columns */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-surface lg:col-span-2 rounded-xl p-6 shadow-sm dark:bg-ink-900/80"
          >
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-brand-500" />
                <h3 className="font-semibold text-ink-900 dark:text-ink-50">{t("dashboard.messageVolume")}</h3>
              </div>
              <span className="rounded-md bg-ink-100 px-2 py-1 text-xs font-medium text-ink-600 dark:bg-white/5 dark:text-ink-200">
                {t("dashboard.last7Days")}
              </span>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data?.messageVolume}>
                  <defs>
                    <linearGradient id="colorInbound" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorOutbound" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={inkSubtle} />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 12, fill: axisTick }}
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 12, fill: axisTick }}
                  />
                  <Tooltip 
                    contentStyle={tooltipStyle}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="inbound" 
                    stroke="#3b82f6" 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#colorInbound)" 
                    name={t("dashboard.inbound")}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="outbound" 
                    stroke="#10b981" 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#colorOutbound)" 
                    name={t("dashboard.outbound")}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* Recent Activity Feed */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="card-surface flex flex-col rounded-xl p-6 shadow-sm dark:bg-ink-900/80"
          >
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-brand-500" />
                <h3 className="font-semibold text-ink-900 dark:text-ink-50">{t("dashboard.activeChats")}</h3>
              </div>
              <Link to="/conversations" className="text-xs font-semibold text-brand-600 hover:text-brand-700">
                {t("dashboard.viewAll")}
              </Link>
            </div>
            <div className="flex-1 space-y-4 overflow-hidden">
              {data?.recentConversations.map((chat) => (
                <Link 
                  key={chat.id} 
                  to={`/conversations/${chat.id}`}
                  className="group flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-ink-50 dark:hover:bg-white/5"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">
                    {chat.contactName[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-ink-900 dark:text-ink-50">{chat.contactName}</p>
                      <span className="whitespace-nowrap text-[10px] text-ink-400 dark:text-ink-500">
                        {formatDistanceToNow(new Date(chat.time), {
                          addSuffix: true,
                          locale: dateLocale,
                        })}
                      </span>
                    </div>
                    <p className="truncate text-xs text-ink-500 dark:text-ink-400">{chat.lastMessage}</p>
                  </div>
                </Link>
              ))}
              {data?.recentConversations.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full py-8 text-center">
                  <p className="text-sm text-ink-400 dark:text-ink-500">{t("dashboard.noActiveConversations")}</p>
                </div>
              )}
            </div>
            <Link 
              to="/contacts" 
              className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-ink-50 px-4 py-2.5 text-xs font-semibold text-ink-600 transition-all hover:bg-brand-50 hover:text-brand-600 dark:bg-white/5 dark:text-ink-200 dark:hover:bg-brand-950/40 dark:hover:text-brand-300"
            >
              {t("dashboard.startNewChat")} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </motion.div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
          {/* Pipeline Funnel Bar Chart */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="card-surface rounded-xl p-6 shadow-sm dark:bg-ink-900/80"
          >
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-brand-500" />
                <h3 className="font-semibold text-ink-900 dark:text-ink-50">{t("dashboard.pipelineFunnel")}</h3>
              </div>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.pipeline} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={inkSubtle} />
                  <XAxis type="number" hide />
                  <YAxis 
                    dataKey="name" 
                    type="category" 
                    axisLine={false} 
                    tickLine={false}
                    tick={{ fontSize: 12, fill: axisTickStrong, fontWeight: 500 }}
                  />
                  <Tooltip 
                    cursor={{ fill: isDark ? "rgba(255,255,255,0.06)" : "#f9fafb" }}
                    contentStyle={tooltipStyle}
                  />
                  <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={32} name="Contacts" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* Tag Distribution Pie Chart */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="card-surface rounded-xl p-6 shadow-sm dark:bg-ink-900/80"
          >
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PieChart className="h-5 w-5 text-brand-500" />
                <h3 className="font-semibold text-ink-900 dark:text-ink-50">{t("dashboard.topTags")}</h3>
              </div>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie
                    data={data?.tags}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {data?.tags.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={tooltipStyle}
                  />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ color: axisTickStrong }} />
                </RePieChart>
              </ResponsiveContainer>
            </div>
          </motion.div>
        </div>
      </div>
    </PageTransition>
  );
}
