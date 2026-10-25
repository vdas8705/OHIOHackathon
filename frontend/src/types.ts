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
}

export interface PerformanceReport {
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
