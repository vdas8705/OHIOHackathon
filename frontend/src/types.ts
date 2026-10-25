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
  overtime_tiers?: OvertimeTier[];
}

export interface CategoryScore {
  name: string;
  score: number;
  max_score: number;
  explanation: string;
  evidence: string[];
  improvements: string[];
  /** This category's share of overtime deductions (already subtracted from score). */
  overtime_deduction?: number;
}

export type { DeliveryMetrics } from "./speech/delivery";
import type { DeliveryMetrics } from "./speech/delivery";

export interface DeliverySummary {
  answers_with_voice: number;
  total_words: number;
  average_wpm: number | null;
  pace_label: string;
  filler_count: number;
  top_fillers: { phrase: string; count: number }[];
  hedge_count: number;
  top_hedges: { phrase: string; count: number }[];
  long_pauses: number;
  tips: string[];
}

export interface EnvironmentState {
  technical_stability: number;
  risk_level: number;
  stakeholder_confidence: number;
  progress: number;
}

export interface DecisionMapRound {
  round_number: number;
  question: string;
  correctness: WalkthroughCorrectness;
  performance_level: string;
  your_choice: string;
  what_happened: string;
  environment_after: EnvironmentState | null;
  what_if: { label: string; approach: string; outcome: string };
}

export interface DecisionMap {
  version: number;
  generated_by: "llm" | "template";
  rounds: DecisionMapRound[];
  your_ending: string;
  best_ending: string;
}

export interface OvertimeTier {
  tier: number;
  starts_after_seconds: number;
  ends_at_seconds: number | null; // null = maximum tier
  penalty_pct: number;
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
  // Section score + overtime (absent on older reports)
  section_points_possible?: number;
  section_points_before_overtime?: number;
  section_points?: number;
  overtime_seconds?: number;
  overtime_tier?: number;
  overtime_penalty_pct?: number;
  overtime_deduction?: number;
  delivery?: DeliveryMetrics | null;
  environment_after?: EnvironmentState | null;
  alternative_outcomes?: Record<string, string>;
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
  // Overtime (absent on older reports)
  overall_score_before_overtime?: number | null;
  overtime_points_lost?: number;
  overtime_tiers?: OvertimeTier[];
  delivery_summary?: DeliverySummary | null;
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
export type SessionOrigin =
  | "user_demo"
  | "user_live"
  | "test_fixture"
  | "unknown";

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
  origin: SessionOrigin;
}

export interface HistoryDetail extends HistorySummary {
  report: PerformanceReport;
  conversation: { role: string; round_number: number; text: string }[];
  walkthrough?: Walkthrough | null;
}

// Spoken results walkthrough (derived from the saved report).
export type WalkthroughCorrectness = "correct" | "partly_correct" | "incorrect";

export interface WalkthroughQuestion {
  round_number: number;
  correctness: WalkthroughCorrectness;
  performance_level: string;
  question: string;
  spoken: string;
}

export interface WalkthroughFollowup {
  round_number: number;
  question: string;
  answer: string;
}

export interface Walkthrough {
  version: number;
  generated_by: "llm" | "template";
  viewed: boolean;
  overall_score: number;
  max_score: number;
  intro: string;
  questions: WalkthroughQuestion[];
  wrap_up: string;
  focus_points: string[];
  followups: WalkthroughFollowup[];
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
