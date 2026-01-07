
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Legend } from 'recharts';
import { analyzeInput } from './geminiService';
import { AnalysisResponse, AppStatus, HistoryItem, UserProfile, UserStats, MealType } from './types';

// Activity Multipliers
const ACTIVITY_LEVELS = [
  { value: '1.2', label: 'بدون تحرک (پشت میز نشین)', emoji: '🛋️' },
  { value: '1.375', label: 'کم تحرک (۱-۳ روز ورزش)', emoji: '🚶' },
  { value: '1.55', label: 'متوسط (۳-۵ روز ورزش)', emoji: '🏃' },
  { value: '1.725', label: 'پر تحرک (۶-۷ روز ورزش)', emoji: '🏋️' },
];

const MEAL_TYPES: { type: MealType; label: string; emoji: string }[] = [
  { type: 'BREAKFAST', label: 'صبحانه', emoji: '🍳' },
  { type: 'LUNCH', label: 'نهار', emoji: '🍚' },
  { type: 'DINNER', label: 'شام', emoji: '🥗' },
  { type: 'SNACK', label: 'میان وعده', emoji: '🍎' },
];

const MEASUREMENT_UNITS = [
  { value: 'گرم', label: 'گرم (g)', emoji: '⚖️' },
  { value: 'قاشق غذاخوری', label: 'قاشق', emoji: '🥄' },
  { value: 'کفگیر', label: 'کفگیر', emoji: '🥘' },
  { value: 'لیوان', label: 'لیوان', emoji: '🥛' },
  { value: 'کف دست', label: 'کف دست', emoji: '✋' },
  { value: 'عدد', label: 'عدد', emoji: '🔢' },
  { value: 'تکه', label: 'تکه', emoji: '🍕' },
  { value: 'بشقاب', label: 'بشقاب', emoji: '🍽️' },
  { value: 'سیخ', label: 'سیخ', emoji: '🍢' },
];

const App: React.FC = () => {
  // Navigation State
  const [activeTab, setActiveTab] = useState<'HOME' | 'PROFILE' | 'STATS'>('HOME');

  // Core App State
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [lastAdvice, setLastAdvice] = useState<string>('');
  
  // New: Meal Type State
  const [selectedMeal, setSelectedMeal] = useState<MealType>('SNACK');

  // Multi-Item Review Queue State
  const [reviewQueue, setReviewQueue] = useState<HistoryItem[]>([]);
  const [originalQueueLength, setOriginalQueueLength] = useState(0);

  // Profile Form State
  const [profileForm, setProfileForm] = useState<UserStats>({
    age: 30,
    gender: 'male',
    weight: 80,
    height: 175,
    activity_level: '1.375',
    weight_loss_per_month: 2
  });

  // Edit History State
  const [editingItem, setEditingItem] = useState<HistoryItem | null>(null);
  const [editFormText, setEditFormText] = useState('');
  const [editFormMealType, setEditFormMealType] = useState<MealType>('SNACK');
  
  // New Amount/Unit State
  const [editFormAmount, setEditFormAmount] = useState<string>('');
  const [editFormUnit, setEditFormUnit] = useState<string>('گرم');

  const [editFormCalories, setEditFormCalories] = useState('');
  const [editFormProtein, setEditFormProtein] = useState('');
  const [editFormCarbs, setEditFormCarbs] = useState('');
  const [editFormFat, setEditFormFat] = useState('');
  const [isCalculatingEdit, setIsCalculatingEdit] = useState(false);

  // --- Initialization & Persistence ---
  useEffect(() => {
    const savedProfile = localStorage.getItem('nissan_profile_v2');
    if (savedProfile) {
      const parsed = JSON.parse(savedProfile);
      setUserProfile(parsed);
      setProfileForm(parsed.stats); // Sync form with saved profile
    } else {
      setActiveTab('PROFILE'); // Force profile setup if no profile
    }

    const savedHistory = localStorage.getItem('nissan_history_v2');
    if (savedHistory) setHistory(JSON.parse(savedHistory));

    // Set initial meal based on time of day
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 11) setSelectedMeal('BREAKFAST');
    else if (hour >= 11 && hour < 16) setSelectedMeal('LUNCH');
    else if (hour >= 16 && hour < 23) setSelectedMeal('DINNER');
    else setSelectedMeal('SNACK');

  }, []);

  useEffect(() => {
    if (userProfile) localStorage.setItem('nissan_profile_v2', JSON.stringify(userProfile));
  }, [userProfile]);

  useEffect(() => {
    localStorage.setItem('nissan_history_v2', JSON.stringify(history));
  }, [history]);

  // --- Logic: Calories & Macros ---
  const consumedToday = useMemo(() => {
    const today = new Date().setHours(0,0,0,0);
    return history
      .filter(h => new Date(h.timestamp).setHours(0,0,0,0) === today && h.action_type === 'FOOD_ENTRY')
      .reduce((sum, h) => sum + (h.calories || 0), 0);
  }, [history]);

  const consumedMacros = useMemo(() => {
    const today = new Date().setHours(0,0,0,0);
    const todaysEntries = history
      .filter(h => new Date(h.timestamp).setHours(0,0,0,0) === today && h.action_type === 'FOOD_ENTRY');
    
    return {
      protein: todaysEntries.reduce((s, h) => s + (h.protein || 0), 0),
      carbs: todaysEntries.reduce((s, h) => s + (h.carbs || 0), 0),
      fat: todaysEntries.reduce((s, h) => s + (h.fat || 0), 0),
    };
  }, [history]);

  const remainingCalories = useMemo(() => {
    if (!userProfile) return 0;
    return Math.max(0, userProfile.tdee - consumedToday);
  }, [userProfile, consumedToday]);

  // --- Logic: Weekly Stats (Current Persian Week: Sat -> Fri) ---
  const weeklyStats = useMemo(() => {
    const stats = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Find the Saturday of the current week
    // JS: Sun=0, Mon=1, ... Sat=6
    // Persian mapping: Sat should be day 0 of the week.
    // Logic: If today is Sat(6), offset is 0. If Sun(0), offset is 1. If Fri(5), offset is 6.
    const dayOfWeek = today.getDay(); // 0-6
    const daysFromSaturday = (dayOfWeek + 1) % 7;
    
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - daysFromSaturday);
    startOfWeek.setHours(0, 0, 0, 0);

    // Generate 7 days (Saturday to Friday)
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      
      const dayStart = d.getTime();
      const dayEnd = dayStart + 86400000; // +1 day in ms

      const dayEntries = history.filter(h => 
        h.timestamp >= dayStart && 
        h.timestamp < dayEnd && 
        h.action_type === 'FOOD_ENTRY'
      );

      const cals = dayEntries.reduce((sum, h) => sum + (h.calories || 0), 0);
      const pro = dayEntries.reduce((sum, h) => sum + (h.protein || 0), 0);
      const carb = dayEntries.reduce((sum, h) => sum + (h.carbs || 0), 0);
      const fat = dayEntries.reduce((sum, h) => sum + (h.fat || 0), 0);

      stats.push({
        name: d.toLocaleDateString('fa-IR', { weekday: 'short' }),
        fullDate: d.toLocaleDateString('fa-IR'),
        calories: cals,
        protein: pro,
        carbs: carb,
        fat: fat,
        goal: userProfile?.tdee || 2000,
        isFuture: d > today
      });
    }
    return stats;
  }, [history, userProfile]);

  // --- Logic: AI Processing ---
  const handleProcess = useCallback(async (textOverride?: string) => {
    const finalInput = textOverride || input;
    if (!finalInput.trim()) return;

    setStatus(AppStatus.LOADING);
    try {
      const result = await analyzeInput(finalInput);
      
      // Update advice
      if (result.advice) setLastAdvice(result.advice);

      // Handle Food Entry
      if (result.action_type === 'FOOD_ENTRY' && result.food_items && result.food_items.length > 0) {
        
        // Map all detected items to HistoryItems
        const newQueueItems: HistoryItem[] = result.food_items.map((item, index) => ({
          id: (Date.now() + index).toString(), // Ensure unique ID for batch
          timestamp: Date.now(),
          inputText: item.food_name, // Use specific name for each item
          action_type: 'FOOD_ENTRY',
          meal_type: selectedMeal, 
          calories: Math.round(item.calories),
          protein: Math.round(item.protein || 0),
          carbs: Math.round(item.carbs || 0),
          fat: Math.round(item.fat || 0),
          amount: item.amount_grams || 0,
          unit: 'گرم' // Default AI unit
        }));

        // Set the Queue and Start with the first one
        if (newQueueItems.length > 0) {
           setReviewQueue(newQueueItems);
           setOriginalQueueLength(newQueueItems.length);
           openEditModal(newQueueItems[0]);
           setInput('');
        }

      } 
      // Handle Conversational Profile Setup
      else if (result.action_type === 'PROFILE_SETUP' && result.user_stats && result.calculated_goal) {
         const newProfile: UserProfile = {
          stats: result.user_stats,
          bmr: 0,
          tdee: result.calculated_goal
        };
        setUserProfile(newProfile);
        setProfileForm(result.user_stats); // Sync form
        alert('پروفایل شما بروز شد.');
        setInput('');
      } else {
        setInput('');
      }

      setStatus(AppStatus.SUCCESS);
    } catch (err) {
      console.error(err);
      setStatus(AppStatus.ERROR);
    }
  }, [input, history, selectedMeal]);


  // --- Logic: Profile Management ---
  const calculateAndSaveProfile = () => {
    const { gender, weight, height, age, activity_level, weight_loss_per_month } = profileForm;
    let bmr = (10 * weight) + (6.25 * height) - (5 * age);
    bmr += (gender === 'male' ? 5 : -161);
    const activityMultiplier = parseFloat(activity_level);
    const maintenance = bmr * activityMultiplier;
    const lossPerMonth = weight_loss_per_month || 0;
    const dailyDeficit = (lossPerMonth * 7700) / 30;
    let dailyGoal = Math.round(maintenance - dailyDeficit);
    if (dailyGoal < 1200) dailyGoal = 1200;

    const newProfile: UserProfile = {
      stats: profileForm,
      bmr: Math.round(bmr),
      tdee: dailyGoal
    };

    setUserProfile(newProfile);
    setActiveTab('HOME');
    setLastAdvice('پروفایل شما با موفقیت ذخیره شد. حالا می‌تونید وعده‌های غذایی رو ثبت کنید.');
  };

  const updateProfileField = (field: keyof UserStats, value: any) => {
    setProfileForm(prev => ({ ...prev, [field]: value }));
  };

  // --- Helpers ---
  const getMealLabel = (type?: MealType) => {
    return MEAL_TYPES.find(m => m.type === type)?.label || 'نامشخص';
  };
  const getMealEmoji = (type?: MealType) => {
     return MEAL_TYPES.find(m => m.type === type)?.emoji || '🍽️';
  };
  const getMealColorClass = (type?: MealType) => {
     switch (type) {
        case 'BREAKFAST': return 'bg-amber-100 text-amber-700';
        case 'LUNCH': return 'bg-emerald-100 text-emerald-700';
        case 'DINNER': return 'bg-indigo-100 text-indigo-700';
        case 'SNACK': return 'bg-pink-100 text-pink-700';
        default: return 'bg-slate-100 text-slate-500';
     }
  };

  // --- Edit Logic ---
  const openEditModal = (item: HistoryItem) => {
    setEditingItem(item);
    setEditFormText(item.inputText);
    setEditFormMealType(item.meal_type || 'SNACK');
    
    // Set Amount & Unit
    setEditFormAmount(item.amount ? item.amount.toString() : '');
    setEditFormUnit(item.unit || 'گرم');

    setEditFormCalories(item.calories?.toString() || '0');
    setEditFormProtein(item.protein?.toString() || '0');
    setEditFormCarbs(item.carbs?.toString() || '0');
    setEditFormFat(item.fat?.toString() || '0');
  };

  const handleSmartRecalculate = async () => {
    if (!editFormText.trim()) return;
    setIsCalculatingEdit(true);
    try {
      // Create a query that explicitly includes the user-entered amount and unit
      const query = `${editFormAmount} ${editFormUnit} ${editFormText}`;
      const result = await analyzeInput(query);
      if (result.food_items && result.food_items.length > 0) {
        const totalCal = result.food_items.reduce((s, i) => s + (i.calories || 0), 0);
        const totalPro = result.food_items.reduce((s, i) => s + (i.protein || 0), 0);
        const totalCarb = result.food_items.reduce((s, i) => s + (i.carbs || 0), 0);
        const totalFat = result.food_items.reduce((s, i) => s + (i.fat || 0), 0);

        setEditFormCalories(Math.round(totalCal).toString());
        setEditFormProtein(Math.round(totalPro).toString());
        setEditFormCarbs(Math.round(totalCarb).toString());
        setEditFormFat(Math.round(totalFat).toString());
      } else {
        alert('محاسبه نشد.');
      }
    } catch {
      alert('خطا در ارتباط.');
    } finally {
      setIsCalculatingEdit(false);
    }
  };

  const saveEditItem = () => {
    if (!editingItem) return;
    const newCalories = parseInt(editFormCalories, 10);
    const newProtein = parseInt(editFormProtein, 10);
    const newCarbs = parseInt(editFormCarbs, 10);
    const newFat = parseInt(editFormFat, 10);
    const newAmount = parseFloat(editFormAmount);

    const updatedItem: HistoryItem = {
      ...editingItem,
      inputText: editFormText,
      meal_type: editFormMealType,
      calories: isNaN(newCalories) ? 0 : newCalories,
      protein: isNaN(newProtein) ? 0 : newProtein,
      carbs: isNaN(newCarbs) ? 0 : newCarbs,
      fat: isNaN(newFat) ? 0 : newFat,
      amount: isNaN(newAmount) ? 0 : newAmount,
      unit: editFormUnit
    };

    // 1. Update History
    setHistory(prev => {
       const exists = prev.find(i => i.id === updatedItem.id);
       if (exists) {
          return prev.map(item => item.id === updatedItem.id ? updatedItem : item);
       } else {
          return [updatedItem, ...prev];
       }
    });

    // 2. Handle Queue for Multiple Items
    // If the current item is part of the queue, we remove it and show the next one.
    if (reviewQueue.length > 0 && reviewQueue[0].id === editingItem.id) {
       const nextQueue = reviewQueue.slice(1);
       setReviewQueue(nextQueue);
       
       if (nextQueue.length > 0) {
          // Open next item immediately
          openEditModal(nextQueue[0]);
       } else {
          // Queue finished
          setEditingItem(null);
          setOriginalQueueLength(0);
       }
    } else {
       // Single item edit mode
       setEditingItem(null);
    }
  };

  const cancelOrSkipItem = () => {
     // If in queue mode, "Cancel" functions as "Skip"
     if (reviewQueue.length > 0 && editingItem && reviewQueue[0].id === editingItem.id) {
        const nextQueue = reviewQueue.slice(1);
        setReviewQueue(nextQueue);
        if (nextQueue.length > 0) {
           openEditModal(nextQueue[0]);
        } else {
           setEditingItem(null);
           setOriginalQueueLength(0);
        }
     } else {
        // Normal cancel
        setEditingItem(null);
     }
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border border-slate-100 shadow-xl rounded-xl text-xs">
          <p className="font-bold mb-1 text-slate-700">{label}</p>
          {payload.map((p: any, index: number) => (
             <div key={index} style={{ color: p.color }} className="font-bold">
               {p.name === 'calories' ? 'کالری: ' : 
                p.name === 'protein' ? 'پروتئین: ' :
                p.name === 'carbs' ? 'کربوهیدرات: ' :
                p.name === 'fat' ? 'چربی: ' : ''}
               {p.value}
             </div>
          ))}
        </div>
      );
    }
    return null;
  };

  const isNewItem = editingItem && !history.some(h => h.id === editingItem.id);
  const isQueueActive = reviewQueue.length > 0 && editingItem && reviewQueue[0].id === editingItem.id;

  return (
    <div className="min-h-screen bg-slate-50 font-['Vazirmatn'] pb-24" dir="rtl">
      
      {/* --- HEADER --- */}
      <header className={`transition-all duration-500 p-4 shadow-lg sticky top-0 z-40 ${userProfile ? 'bg-emerald-600' : 'bg-slate-800'} text-white`}>
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
             {/* Logo Container */}
            <div className="bg-white p-1 rounded-full shadow-lg h-14 w-14 flex items-center justify-center overflow-hidden shrink-0">
               {/* USER PROVIDED LOGO */}
               <img 
                 src="logo.png" 
                 alt="Nissan Salamat" 
                 className="w-full h-full object-contain"
                 onError={(e) => {
                    const parent = e.currentTarget.parentElement;
                    if (parent) {
                        e.currentTarget.style.display = 'none';
                        parent.innerText = '🍎';
                        parent.style.fontSize = '2rem';
                    }
                 }}
               />
            </div>
            <div className="flex flex-col">
              <h1 className="text-xl font-black tracking-tight drop-shadow-md">نیسان سلامت</h1>
              <span className="text-[10px] text-white/90 font-bold -mt-0.5 opacity-90">کالری شمار هوشمند</span>
            </div>
          </div>
          {userProfile && activeTab === 'HOME' && (
             <div className="text-center">
                <div className="text-[10px] text-emerald-200 uppercase font-bold">باقیمانده</div>
                <div className="text-2xl font-black">{remainingCalories}</div>
             </div>
          )}
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 mt-6">
        
        {/* --- TAB: PROFILE --- */}
        {activeTab === 'PROFILE' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
            <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
              <h2 className="text-xl font-black text-slate-800 mb-6 flex items-center gap-2">
                👤 تنظیمات پروفایل
              </h2>
              
              <div className="space-y-5">
                {/* Gender */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-2">جنسیت</label>
                  <div className="flex bg-slate-100 p-1 rounded-xl">
                    <button 
                      onClick={() => updateProfileField('gender', 'male')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${profileForm.gender === 'male' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'}`}
                    >
                      👨 مرد
                    </button>
                    <button 
                      onClick={() => updateProfileField('gender', 'female')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${profileForm.gender === 'female' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'}`}
                    >
                      👩 زن
                    </button>
                  </div>
                </div>

                {/* Age & Height */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2">سن (سال)</label>
                    <input 
                      type="number" 
                      value={profileForm.age}
                      onChange={(e) => updateProfileField('age', Number(e.target.value))}
                      className="w-full bg-slate-50 border-2 border-slate-100 focus:border-emerald-400 rounded-xl p-3 font-bold text-slate-700 text-center outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2">قد (cm)</label>
                    <input 
                      type="number" 
                      value={profileForm.height}
                      onChange={(e) => updateProfileField('height', Number(e.target.value))}
                      className="w-full bg-slate-50 border-2 border-slate-100 focus:border-emerald-400 rounded-xl p-3 font-bold text-slate-700 text-center outline-none"
                    />
                  </div>
                </div>

                {/* Weight */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-2">وزن فعلی (kg)</label>
                  <input 
                    type="number" 
                    value={profileForm.weight}
                    onChange={(e) => updateProfileField('weight', Number(e.target.value))}
                    className="w-full bg-slate-50 border-2 border-slate-100 focus:border-emerald-400 rounded-xl p-3 font-bold text-slate-700 text-center outline-none text-lg"
                  />
                </div>

                {/* Activity */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-2">میزان فعالیت روزانه</label>
                  <div className="space-y-2">
                    {ACTIVITY_LEVELS.map(level => (
                      <div 
                        key={level.value}
                        onClick={() => updateProfileField('activity_level', level.value)}
                        className={`p-3 rounded-xl border-2 cursor-pointer transition-all flex items-center gap-3 ${profileForm.activity_level === level.value ? 'border-emerald-500 bg-emerald-50' : 'border-transparent bg-slate-50'}`}
                      >
                        <span className="text-xl">{level.emoji}</span>
                        <span className={`text-sm font-bold ${profileForm.activity_level === level.value ? 'text-emerald-700' : 'text-slate-600'}`}>{level.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="w-full h-px bg-slate-100 my-4"></div>

                {/* Target */}
                <div>
                   <label className="block text-xs font-bold text-red-400 mb-2">📉 هدف کاهش وزن (کیلو در ماه)</label>
                   <div className="flex items-center gap-4">
                      <input 
                        type="range" 
                        min="0" max="6" step="0.5"
                        value={profileForm.weight_loss_per_month || 0}
                        onChange={(e) => updateProfileField('weight_loss_per_month', Number(e.target.value))}
                        className="flex-1 accent-emerald-500 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                      />
                      <span className="font-black text-slate-800 w-12 text-center">{profileForm.weight_loss_per_month}</span>
                   </div>
                   <p className="text-[10px] text-slate-400 mt-2 text-justify leading-4">
                     توصیه: کاهش وزن ایمن بین ۰.۵ تا ۴ کیلوگرم در ماه است. اعداد بالاتر ممکن است برای سلامتی مضر باشد.
                   </p>
                </div>

                <button 
                  onClick={calculateAndSaveProfile}
                  className="w-full bg-slate-800 text-white py-4 rounded-xl font-black shadow-lg hover:bg-slate-900 active:scale-95 transition-all mt-4"
                >
                  ذخیره و محاسبه برنامه
                </button>

              </div>
            </div>
          </div>
        )}

        {/* --- TAB: HOME --- */}
        {activeTab === 'HOME' && userProfile && (
          <div className="space-y-6 animate-in fade-in duration-500">
            
            {/* Advice Box */}
            {lastAdvice && (
              <div className="bg-white p-4 rounded-2xl border-r-4 border-emerald-500 shadow-sm flex gap-3 items-start">
                 <span className="text-xl">💡</span>
                 <p className="text-sm font-bold text-emerald-800 leading-6">{lastAdvice}</p>
              </div>
            )}

            {/* Input Area */}
            <section className="bg-white p-6 rounded-[2rem] shadow-lg border border-slate-100 text-center relative overflow-hidden">
               <h3 className="font-black text-slate-700 mb-4">چه خوراکی خوردی؟</h3>
               
               {/* New: Meal Type Selector */}
               <div className="flex justify-between gap-1 mb-4 bg-slate-100 p-1 rounded-xl">
                  {MEAL_TYPES.map(meal => (
                     <button
                        key={meal.type}
                        onClick={() => setSelectedMeal(meal.type)}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${selectedMeal === meal.type ? 'bg-white text-emerald-700 shadow-sm scale-105' : 'text-slate-400 hover:text-slate-600'}`}
                     >
                        <span className="block text-lg mb-0.5">{meal.emoji}</span>
                        {meal.label}
                     </button>
                  ))}
               </div>

               <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="w-full h-24 bg-slate-50 rounded-xl p-4 text-sm font-bold text-slate-700 border-none outline-none resize-none mb-4 focus:ring-2 focus:ring-emerald-200 transition-all"
                  placeholder="اینجا بنویس (مثلاً: ناهار قرمه سبزی با برنج خوردم)..."
               />

               {/* Send Button or Loader */}
               {status === AppStatus.LOADING ? (
                 <div className="flex justify-center py-3">
                    <div className="h-8 w-8 border-4 border-slate-200 border-t-emerald-500 rounded-full animate-spin"></div>
                 </div>
               ) : (
                 <button 
                   onClick={() => handleProcess()}
                   disabled={input.trim().length === 0}
                   className="w-full bg-slate-800 text-white py-3 rounded-xl font-bold animate-in zoom-in disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                 >
                   ثبت نوشته 📤
                 </button>
               )}
            </section>

            {/* Daily Progress */}
            <div className="bg-white p-5 rounded-[2rem] border border-slate-100 shadow-sm">
               <div className="flex justify-between items-end mb-2">
                 <span className="text-xs font-bold text-slate-400">کالری مصرف شده</span>
                 <span className="text-lg font-black text-slate-800">{consumedToday} <span className="text-xs font-normal text-slate-400">/ {userProfile.tdee}</span></span>
               </div>
               <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden mb-3">
                  <div 
                    className={`h-full transition-all duration-1000 ${consumedToday > userProfile.tdee ? 'bg-red-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.min(100, (consumedToday / userProfile.tdee) * 100)}%` }}
                  ></div>
               </div>
               {/* Daily Macros Summary */}
               <div className="flex justify-between gap-2 pt-2 border-t border-slate-50">
                  <div className="flex flex-col items-center flex-1">
                     <span className="text-[10px] text-slate-400 font-bold mb-1">پروتئین</span>
                     <span className="text-sm font-black text-slate-700 bg-orange-50 px-2 py-1 rounded-lg w-full text-center border border-orange-100">{consumedMacros.protein}g</span>
                  </div>
                  <div className="flex flex-col items-center flex-1">
                     <span className="text-[10px] text-slate-400 font-bold mb-1">کربوهیدرات</span>
                     <span className="text-sm font-black text-slate-700 bg-blue-50 px-2 py-1 rounded-lg w-full text-center border border-blue-100">{consumedMacros.carbs}g</span>
                  </div>
                  <div className="flex flex-col items-center flex-1">
                     <span className="text-[10px] text-slate-400 font-bold mb-1">چربی</span>
                     <span className="text-sm font-black text-slate-700 bg-yellow-50 px-2 py-1 rounded-lg w-full text-center border border-yellow-100">{consumedMacros.fat}g</span>
                  </div>
               </div>
            </div>

            {/* History List */}
            <div className="space-y-3 pb-4">
              <h3 className="font-bold text-slate-400 text-sm px-2">وعده‌های امروز</h3>
              {history.filter(h => h.action_type === 'FOOD_ENTRY').length === 0 ? (
                <div className="text-center py-8 opacity-40 grayscale">
                   <span className="text-4xl block mb-2">🍽️</span>
                   <span className="text-xs font-bold">هنوز چیزی ثبت نشده</span>
                </div>
              ) : (
                history.filter(h => h.action_type === 'FOOD_ENTRY').slice().reverse().map(item => (
                  <div key={item.id} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-3 transition-all hover:shadow-md">
                    <div className="flex justify-between items-start">
                      <div className="flex items-start gap-3 flex-1">
                        {/* Meal Emoji Box */}
                        <div className={`h-12 w-12 rounded-2xl flex items-center justify-center text-2xl shrink-0 ${
                            item.meal_type === 'BREAKFAST' ? 'bg-amber-100 text-amber-600' :
                            item.meal_type === 'LUNCH' ? 'bg-emerald-100 text-emerald-600' :
                            item.meal_type === 'DINNER' ? 'bg-indigo-100 text-indigo-600' :
                            'bg-pink-100 text-pink-600'
                        }`}>
                          {getMealEmoji(item.meal_type)}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                           {/* Meal Label & Time */}
                           <div className="flex items-center gap-2 mb-1">
                             <span className={`text-[10px] px-2 py-0.5 rounded-md font-black tracking-wide ${getMealColorClass(item.meal_type)}`}>
                               {getMealLabel(item.meal_type)}
                             </span>
                             <span className="text-[10px] text-slate-300">|</span>
                             <span className="text-[10px] font-bold text-slate-400">
                               {new Date(item.timestamp).toLocaleTimeString('fa-IR', {hour:'2-digit', minute:'2-digit'})}
                             </span>
                           </div>
                           
                           {/* Food Name */}
                           <div className="font-bold text-slate-800 text-sm leading-6 break-words">
                             {item.inputText}
                           </div>
                           
                           {/* Amount */}
                           {(item.amount && item.amount > 0) && (
                              <div className="text-[10px] text-slate-500 font-bold mt-0.5 flex items-center gap-1">
                                <span>⚖️</span> {item.amount} {item.unit}
                              </div>
                           )}
                        </div>
                      </div>
                      
                      {/* Calories & Buttons */}
                      <div className="flex flex-col items-end gap-3 pl-1">
                         <div className="text-right">
                            <span className="font-black text-emerald-600 text-lg block leading-none">{item.calories}</span>
                            <span className="text-[9px] font-bold text-slate-400">کالری</span>
                         </div>
                         
                         <div className="flex gap-1">
                            <button 
                              onClick={() => openEditModal(item)} 
                              className="w-8 h-8 flex items-center justify-center bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors"
                            >
                              <span className="text-sm">✎</span>
                            </button>
                            <button 
                              onClick={() => setHistory(prev => prev.filter(i => i.id !== item.id))} 
                              className="w-8 h-8 flex items-center justify-center bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-colors"
                            >
                              <span className="text-sm">×</span>
                            </button>
                         </div>
                      </div>
                    </div>
                    
                    {/* Macros */}
                    <div className="grid grid-cols-3 gap-2 mt-1">
                         <div className="bg-orange-50 rounded-lg p-1.5 text-center">
                            <div className="text-[9px] text-orange-400 font-bold mb-0.5">پروتئین</div>
                            <div className="text-xs font-black text-orange-700">{item.protein || 0}</div>
                         </div>
                         <div className="bg-blue-50 rounded-lg p-1.5 text-center">
                            <div className="text-[9px] text-blue-400 font-bold mb-0.5">کربوهیدرات</div>
                            <div className="text-xs font-black text-blue-700">{item.carbs || 0}</div>
                         </div>
                         <div className="bg-yellow-50 rounded-lg p-1.5 text-center">
                            <div className="text-[9px] text-yellow-500 font-bold mb-0.5">چربی</div>
                            <div className="text-xs font-black text-yellow-700">{item.fat || 0}</div>
                         </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* --- TAB: STATS --- */}
        {activeTab === 'STATS' && (
          <div className="animate-in fade-in duration-500 space-y-6">
            <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
               <h2 className="text-xl font-black text-slate-800 mb-2 flex items-center gap-2">
                📊 گزارش هفتگی
              </h2>
              <p className="text-xs text-slate-400 mb-6">عملکرد هفته جاری (شنبه تا جمعه)</p>

              {/* Chart 1: Calories */}
              <div className="mb-8">
                 <h3 className="text-sm font-bold text-emerald-700 mb-4 bg-emerald-50 inline-block px-3 py-1 rounded-lg">روند مصرف کالری</h3>
                 <div className="h-64 w-full -mr-4">
                   <ResponsiveContainer width="100%" height="100%">
                     <BarChart data={weeklyStats} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                       <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                       <XAxis dataKey="name" reversed={true} tick={{fontFamily:'Vazirmatn', fontSize: 10}} stroke="#cbd5e1" axisLine={false} tickLine={false} />
                       <YAxis hide domain={[0, 'auto']} />
                       <Tooltip content={<CustomTooltip />} cursor={{fill: '#f0fdf4'}} />
                       <ReferenceLine y={userProfile?.tdee} stroke="red" strokeDasharray="3 3" label={{ position: 'top',  value: 'هدف', fontSize: 10, fill: 'red' }} />
                       <Bar dataKey="calories" fill="#10b981" radius={[6, 6, 0, 0]} barSize={24} name="calories" />
                     </BarChart>
                   </ResponsiveContainer>
                 </div>
              </div>

              {/* Chart 2: Macros */}
              <div>
                 <h3 className="text-sm font-bold text-slate-700 mb-4 bg-slate-50 inline-block px-3 py-1 rounded-lg">ترکیب درشت مغذی‌ها</h3>
                 <div className="h-64 w-full -mr-4">
                   <ResponsiveContainer width="100%" height="100%">
                     <BarChart data={weeklyStats} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                       <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                       <XAxis dataKey="name" reversed={true} tick={{fontFamily:'Vazirmatn', fontSize: 10}} stroke="#cbd5e1" axisLine={false} tickLine={false} />
                       <YAxis hide />
                       <Tooltip content={<CustomTooltip />} cursor={{fill: '#f8fafc'}} />
                       <Legend wrapperStyle={{fontSize: '12px', paddingTop: '10px'}} />
                       <Bar dataKey="protein" stackId="a" fill="#fb923c" name="پروتئین" radius={[0,0,0,0]} barSize={24} />
                       <Bar dataKey="carbs" stackId="a" fill="#3b82f6" name="کربوهیدرات" radius={[0,0,0,0]} barSize={24} />
                       <Bar dataKey="fat" stackId="a" fill="#eab308" name="چربی" radius={[6, 6, 0, 0]} barSize={24} />
                     </BarChart>
                   </ResponsiveContainer>
                 </div>
              </div>

            </div>
          </div>
        )}

        {/* Empty State for Home if no profile */}
        {activeTab === 'HOME' && !userProfile && (
           <div className="text-center py-20">
              <p className="text-slate-500 font-bold mb-4">برای شروع، لطفا پروفایل خود را تکمیل کنید.</p>
              <button onClick={() => setActiveTab('PROFILE')} className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold">رفتن به پروفایل</button>
           </div>
        )}

      </main>

      {/* --- BOTTOM NAVIGATION --- */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 pb-safe pt-2 px-6 flex justify-around items-center z-50 h-20 shadow-[0_-5px_10px_rgba(0,0,0,0.02)]">
        <button 
          onClick={() => setActiveTab('HOME')}
          className={`flex flex-col items-center gap-1 transition-all duration-300 ${activeTab === 'HOME' ? 'text-emerald-600 -translate-y-2' : 'text-slate-300'}`}
        >
          <div className={`p-3 rounded-2xl ${activeTab === 'HOME' ? 'bg-emerald-100 shadow-lg shadow-emerald-100' : 'bg-transparent'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={activeTab === 'HOME' ? 2.5 : 2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </div>
          <span className="text-[10px] font-bold">خانه</span>
        </button>

        <button 
          onClick={() => setActiveTab('STATS')}
          className={`flex flex-col items-center gap-1 transition-all duration-300 ${activeTab === 'STATS' ? 'text-blue-600 -translate-y-2' : 'text-slate-300'}`}
        >
          <div className={`p-3 rounded-2xl ${activeTab === 'STATS' ? 'bg-blue-100 shadow-lg' : 'bg-transparent'}`}>
             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={activeTab === 'STATS' ? 2.5 : 2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <span className="text-[10px] font-bold">گزارش</span>
        </button>

        <button 
          onClick={() => setActiveTab('PROFILE')}
          className={`flex flex-col items-center gap-1 transition-all duration-300 ${activeTab === 'PROFILE' ? 'text-slate-800 -translate-y-2' : 'text-slate-300'}`}
        >
          <div className={`p-3 rounded-2xl ${activeTab === 'PROFILE' ? 'bg-slate-100 shadow-lg' : 'bg-transparent'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={activeTab === 'PROFILE' ? 2.5 : 2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <span className="text-[10px] font-bold">پروفایل</span>
        </button>
      </nav>

      {/* --- MODALS --- */}
      {/* Edit/Review Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white rounded-[2rem] p-6 w-full max-w-sm shadow-2xl overflow-hidden">
            
            {/* Progress Bar for Queue */}
            {isQueueActive && (
              <div className="mb-4 bg-slate-100 rounded-full h-2 w-full overflow-hidden">
                 <div 
                   className="bg-emerald-500 h-full transition-all duration-300" 
                   style={{ width: `${((originalQueueLength - reviewQueue.length + 1) / originalQueueLength) * 100}%` }}
                 ></div>
              </div>
            )}

            <h3 className="font-black text-lg mb-4 text-center text-black">
               {isQueueActive ? `بررسی مورد ${originalQueueLength - reviewQueue.length + 1} از ${originalQueueLength}` : (isNewItem ? '📝 تایید مقادیر' : 'ویرایش وعده')}
            </h3>
            
            {isNewItem && (
              <div className="bg-amber-50 text-amber-700 p-3 rounded-xl text-xs font-bold mb-4 text-center border border-amber-100">
                🤖 من مقدار را {editingItem.amount} گرم فرض کردم.<br/>لطفاً مقدار دقیق مصرفی خود را در زیر وارد کنید.
              </div>
            )}

            <div className="space-y-4">
               <div>
                  <label className="text-[10px] text-slate-400 font-bold mr-1">نام غذا</label>
                  <input type="text" value={editFormText} onChange={(e) => setEditFormText(e.target.value)} className="w-full bg-slate-50 border rounded-xl p-3 font-bold text-sm text-black" />
               </div>

               {/* Meal Type Selector */}
               <div>
                  <label className="text-[10px] text-slate-400 font-bold mr-1">نوع وعده</label>
                  <div className="flex gap-1 bg-slate-100 p-1 rounded-xl overflow-x-auto">
                    {MEAL_TYPES.map(meal => (
                        <button
                        key={meal.type}
                        onClick={() => setEditFormMealType(meal.type)}
                        className={`flex-1 py-2 px-1 rounded-lg text-[10px] font-bold transition-all whitespace-nowrap ${editFormMealType === meal.type ? 'bg-white shadow-sm text-slate-800' : 'text-slate-400'}`}
                        >
                        {meal.emoji} {meal.label}
                        </button>
                    ))}
                  </div>
               </div>

               {/* Amount & Unit Selector */}
               <div>
                  <div className="flex justify-between items-end mb-1">
                      <label className="text-[10px] text-slate-400 font-bold mr-1">مقدار مصرفی</label>
                  </div>
                  
                  <div className="flex gap-2 mb-2">
                       <input 
                         type="number" 
                         value={editFormAmount} 
                         onChange={(e) => setEditFormAmount(e.target.value)} 
                         placeholder="مثلا 10"
                         className="w-24 bg-slate-50 border border-slate-200 focus:border-emerald-400 rounded-xl p-3 font-bold text-lg text-center text-black" 
                       />
                       {/* Horizontal Scrollable Unit Selector */}
                       <div className="flex-1 flex gap-2 overflow-x-auto pb-1 no-scrollbar items-center">
                          {MEASUREMENT_UNITS.map((u) => (
                             <button
                                key={u.value}
                                onClick={() => setEditFormUnit(u.value)}
                                className={`
                                   shrink-0 px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border
                                   ${editFormUnit === u.value
                                      ? 'bg-slate-800 text-white border-slate-800 shadow-md transform scale-105'
                                      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                                   }
                                `}
                             >
                                <span className="text-base">{u.emoji}</span>
                                {u.label}
                             </button>
                          ))}
                       </div>
                  </div>
               </div>
               
               <div className="grid grid-cols-2 gap-3">
                 <div className="col-span-2">
                    <label className="text-[10px] text-emerald-600 font-bold mr-1">کالری (با توجه به مقدار بالا)</label>
                    <div className="flex gap-2">
                       <input type="number" value={editFormCalories} onChange={(e) => setEditFormCalories(e.target.value)} className="w-full bg-slate-50 border border-emerald-200 focus:border-emerald-500 rounded-xl p-3 font-bold text-sm text-center text-black" />
                       <button onClick={handleSmartRecalculate} disabled={isCalculatingEdit} className="bg-indigo-100 text-indigo-600 rounded-xl px-4 text-xl shrink-0">
                         {isCalculatingEdit ? '⌛' : '🤖'}
                       </button>
                    </div>
                 </div>
                 
                 <div>
                    <label className="text-[10px] text-orange-500 font-bold mr-1">پروتئین</label>
                    <input type="number" value={editFormProtein} onChange={(e) => setEditFormProtein(e.target.value)} className="w-full bg-slate-50 border focus:border-orange-300 rounded-xl p-2 font-bold text-xs text-center text-black" />
                 </div>
                 <div>
                    <label className="text-[10px] text-blue-500 font-bold mr-1">کربوهیدرات</label>
                    <input type="number" value={editFormCarbs} onChange={(e) => setEditFormCarbs(e.target.value)} className="w-full bg-slate-50 border focus:border-blue-300 rounded-xl p-2 font-bold text-xs text-center text-black" />
                 </div>
                 <div className="col-span-2">
                    <label className="text-[10px] text-yellow-600 font-bold mr-1">چربی</label>
                    <input type="number" value={editFormFat} onChange={(e) => setEditFormFat(e.target.value)} className="w-full bg-slate-50 border focus:border-yellow-300 rounded-xl p-2 font-bold text-xs text-center text-black" />
                 </div>
               </div>

               <div className="flex gap-3 pt-4 border-t border-slate-100 mt-2">
                 <button onClick={cancelOrSkipItem} className="flex-1 py-3 text-slate-400 font-bold bg-slate-50 rounded-xl text-sm">
                    {isQueueActive ? 'نادیده گرفتن 🗑️' : 'لغو'}
                 </button>
                 <button onClick={saveEditItem} className="flex-1 py-3 bg-emerald-600 text-white font-bold rounded-xl shadow-lg text-sm">
                   {isQueueActive 
                     ? (reviewQueue.length > 1 ? 'تایید و بعدی ➡️' : 'تایید نهایی ✅') 
                     : (isNewItem ? 'تایید و افزودن ✅' : 'ذخیره تغییرات')
                   }
                 </button>
               </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default App;
