// Mirrors the backend Pydantic contracts (backend/app/models.py).

export type CompletionStatus =
  | "in_progress"
  | "completed"
  | "timed_out"
  | "ended_early";

export interface PublicScenario {
  scenario_title: string;
  target_role: string;
  challenge_summary: string;
  initial_context: string;
  stakeholders: string[];
}

export interface InterviewerTurn {
  round_number: number;
  development: string;
  question: string;
}

export interface SimulationState {
  session_id: string;
  company: string;
  job_title: string;
  scenario: PublicScenario;
  current_round: number;
  total_rounds: number;
  completion_status: CompletionStatus;
  response_seconds_per_round: number;
  max_active_seconds: number;
  elapsed_active_seconds: number;
  clarifications_used_this_round: number;
  max_clarifications_per_round: number;
  current_turn: InterviewerTurn | null;
  is_demo: boolean;
  report_ready: boolean;
}

export interface CategoryScore {
  name: string;
  score: number;
  max_score: number;
  explanation: string;
  evidence: string[];
  improvements: string[];
}

export interface RoundReport {
  round_number: number;
  question: string;
  response: string;
  consequence: string;
  analysis: string;
  timed_out: boolean;
  question_type?: string;
  secondary_types?: string[];
  competencies?: string[];
  what_went_well?: string;
  what_was_missed?: string;
  stronger_approach?: string;
  why_it_mattered?: string;
  performance_level?: "Strong" | "Developing" | "Needs Improvement" | "Not attempted";
  clarifications?: { question: string; answer: string }[];
}

export interface QuestionPerformance {
  question_id: string;
  round_number: number;
  question: string;
  question_type: string;
  secondary_types: string[];
  competencies: string[];
  indicator: number;
  evidence: string[];
  mistakes: string[];
  improvement_advice: string;
}

export interface QuestionTypeStat {
  question_type: string;
  count: number;
  average_indicator: number;
  common_mistakes: string[];
  suggested_improvement: string;
}

export interface Weakness {
  label: string;
  kind: "observed" | "potential";
  category: string;
  evidence: string[];
  detail: string;
}

export interface PracticeRecommendation {
  weakness: string;
  evidence: string;
  recommendation: string;
}

export interface PerformanceReport {
  schema_version?: number;
  overall_score: number;
  max_score: number;
  completion_status: CompletionStatus;
  completion_percentage: number;
  rounds_attempted: number;
  total_active_seconds: number;
  categories: CategoryScore[];
  summary: string;
  strengths: string[];
  improvements: string[];
  missed_considerations: string[];
  suggested_next_steps: string[];
  overall_recommendation: string;
  round_reports: RoundReport[];
  is_demo: boolean;
  question_performance?: QuestionPerformance[];
  question_type_stats?: QuestionTypeStat[];
  weaknesses?: Weakness[];
  practice_recommendations?: PracticeRecommendation[];
}

export interface CreateSimulationInput {
  company: string;
  job_title: string;
  job_description: string;
  company_info: string;
  website_url: string;
}

export interface FetchJobResponse {
  company: string;
  job_title: string;
  job_description: string;
  company_info: string;
}

export type Correctness = "correct" | "partly_correct" | "incorrect";

export interface QuestionReview {
  round_number: number;
  question: string;
  user_answer: string;
  correctness: Correctness;
  what_did_well: string;
  what_missed: string;
  better_approach: string;
  explanation: string;
}

export interface SessionReview {
  score: number;
  total: number;
  summary: string;
  question_reviews: QuestionReview[];
  tips: string[];
  is_demo: boolean;
}

export interface InterpretResponse {
  interpretation: string;
  clarifications_used: number;
  max_clarifications: number;
}

export interface SavedSession {
  id: string;
  company: string;
  job_title: string;
  completedAt: number; // epoch ms
  score: number;
  total: number;
  status: string;
  bubbles: { id: string; role: string; text: string; round: number }[];
  review: SessionReview | null;
}

export interface DemoSample extends CreateSimulationInput {
  example_responses: Record<string, string>;
}

// --- Persistent history (backend SQLite) ---
export interface HistorySummary {
  session_id: string;
  company: string;
  job_title: string;
  scenario_title: string;
  is_demo: boolean;
  completion_status: string;
  rounds_completed: number;
  active_seconds: number;
  overall_score: number | null;
  schema_version: number;
  created_at: string; // ISO timestamp
}

export interface HistoryDetail extends HistorySummary {
  report: PerformanceReport;
  conversation: { role: string; round_number: number; text: string }[];
}

export interface TrendPoint {
  created_at: string;
  score?: number;
  value?: number;
}

export interface RecurringWeakness {
  question_type: string;
  average_indicator: number;
  questions_counted: number;
  sessions_counted: number;
  detail: string;
}

export interface CompetencyTrend {
  competency: string;
  direction: "improving" | "declining";
  delta: number;
  detail: string;
}

export interface HistoryTrends {
  has_enough_data: boolean;
  completed_sessions: number;
  message: string;
  overall_score_series: TrendPoint[];
  competency_series: Record<string, TrendPoint[]>;
  recurring_weaknesses: RecurringWeakness[];
  improvements: CompetencyTrend[];
}

export interface HealthInfo {
  status: string;
  demo_mode: boolean;
  model: string | null;
}

export interface ClarifyResponse {
  answer: string;
  clarifications_used_this_round: number;
  max_clarifications_per_round: number;
}
