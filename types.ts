
export interface FoodItem {
  food_name: string;
  amount_grams: number;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

export interface UserStats {
  age: number;
  gender: 'male' | 'female';
  weight: number;
  height: number;
  activity_level: string;
  target_weight?: number;
  weight_loss_per_month?: number;
}

export interface UserProfile {
  stats: UserStats;
  bmr: number;
  tdee: number; // Daily Calorie Goal
}

export interface AnalysisResponse {
  action_type: 'PROFILE_SETUP' | 'FOOD_ENTRY' | 'UNKNOWN';
  user_stats?: UserStats;
  calculated_goal?: number;
  food_items?: FoodItem[];
  advice: string;
}

export type MealType = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK';

export interface HistoryItem {
  id: string;
  timestamp: number;
  inputText: string;
  action_type: 'PROFILE_SETUP' | 'FOOD_ENTRY';
  meal_type?: MealType; 
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  // New fields for portion tracking
  amount?: number;
  unit?: string;
}

export enum AppStatus {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}
