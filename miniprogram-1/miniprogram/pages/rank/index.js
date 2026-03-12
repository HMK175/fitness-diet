const { STORAGE_KEYS, loadJSON } = require("../../utils/storage");

const BUILT_IN_FOODS = [
  { id: "egg", name: "鸡蛋", proteinPer100g: 13, carbsPer100g: 1.3, fatPer100g: 11, systemBuiltIn: true },
  { id: "chicken_leg", name: "鸡腿", proteinPer100g: 18, carbsPer100g: 0, fatPer100g: 8, systemBuiltIn: true },
  { id: "duck_leg", name: "鸭腿", proteinPer100g: 17, carbsPer100g: 0, fatPer100g: 12, systemBuiltIn: true },
  { id: "rice_cooked", name: "米饭（熟）", proteinPer100g: 2.6, carbsPer100g: 28, fatPer100g: 0.3, systemBuiltIn: true },
];

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeFoods(foods) {
  const safe = Array.isArray(foods) ? foods : [];
  const userFoods = safe.filter((f) => f && f.id && !f.systemBuiltIn);
  const normalizedBuiltIns = BUILT_IN_FOODS.map((bf) => ({ ...bf, systemBuiltIn: true }));
  return [...normalizedBuiltIns, ...userFoods];
}

function calcEntryMacros(food, grams) {
  const factor = grams / 100;
  return {
    protein: food.proteinPer100g * factor,
    carbs: food.carbsPer100g * factor,
    fat: food.fatPer100g * factor,
  };
}

function getOrCreateDayLog(logs, dateStr) {
  if (!logs[dateStr]) {
    logs[dateStr] = {
      date: dateStr,
      meals: [
        { id: "breakfast", name: "早餐", entries: [] },
        { id: "lunch", name: "午餐", entries: [] },
        { id: "dinner", name: "晚餐", entries: [] },
      ],
    };
  }
  return logs[dateStr];
}

function calcDayTotals(dayLog, foods) {
  if (!dayLog) return { protein: 0, carbs: 0, fat: 0 };
  let protein = 0,
    carbs = 0,
    fat = 0;
  (dayLog.meals || []).forEach((meal) => {
    (meal.entries || []).forEach((entry) => {
      const food = foods.find((f) => f.id === entry.foodId);
      if (!food) return;
      const macros = entry.macros || calcEntryMacros(food, entry.grams);
      protein += macros.protein;
      carbs += macros.carbs;
      fat += macros.fat;
    });
  });
  return { protein, carbs, fat };
}

Page({
  data: {
    rankDate: todayStr(),
    rankTab: "kcal",
    rankRows: [],
    rankLoading: false,
    rankForm: {
      bench1rm: "",
      deadlift1rm: "",
      squat1rm: "",
    },
    settings: null,
    foods: [],
    logs: {},
  },

  onLoad() {
    const settings = loadJSON(STORAGE_KEYS.SETTINGS, null) || {};
    const foods = normalizeFoods(loadJSON(STORAGE_KEYS.FOODS, []) || []);
    const logs = loadJSON(STORAGE_KEYS.LOGS, {}) || {};
    this.setData(
      {
        settings,
        foods,
        logs,
      },
      () => {
        this.fetchRank();
      }
    );
  },

  onRankDateChange(e) {
    const date = e.detail.value;
    if (!date) return;
    this.setData(
      {
        rankDate: date,
      },
      () => {
        this.fetchRank();
      }
    );
  },

  onRankTabTap(e) {
    const tab = e.currentTarget.dataset.tab === "strength" ? "strength" : "kcal";
    this.setData({ rankTab: tab });
  },

  onRankFormInput(e) {
    const field = e.currentTarget.dataset.field;
    const v = e.detail.value;
    const key = `rankForm.${field}`;
    this.setData({ [key]: v });
  },

  async fetchRank() {
    this.setData({ rankLoading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: "rank",
        data: {
          action: "get",
          date: this.data.rankDate,
        },
      });
      const rows = (res.result && res.result.data) || [];
      this.setData({ rankRows: rows });
    } catch (e) {
      console.error("fetchRank error:", e);
      wx.showToast({ title: "加载排行榜失败", icon: "none" });
    } finally {
      this.setData({ rankLoading: false });
    }
  },

  async onRankUploadTap() {
    const { settings, logs, rankDate, rankForm, foods } = this.data;
    const dayLog = getOrCreateDayLog(logs, rankDate);
    const totals = calcDayTotals(dayLog, foods);
    const kcal =
      (Number(totals.protein) || 0) * 4 +
      (Number(totals.carbs) || 0) * 4 +
      (Number(totals.fat) || 0) * 9;

    const bw = Number(settings.weightKg);
    if (!bw || bw <= 0) {
      wx.showToast({ title: "请先在首页填写体重并保存配置", icon: "none" });
      return;
    }

    const payload = {
      date: rankDate,
      bodyweight_kg: bw,
      kcal: Math.round(kcal),
      protein_g: Number(totals.protein.toFixed(1)),
      carbs_g: Number(totals.carbs.toFixed(1)),
      fat_g: Number(totals.fat.toFixed(1)),
      bench_1rm: parseFloat(rankForm.bench1rm) || null,
      deadlift_1rm: parseFloat(rankForm.deadlift1rm) || null,
      squat_1rm: parseFloat(rankForm.squat1rm) || null,
    };

    try {
      wx.showLoading({ title: "上传中...", mask: true });
      await wx.cloud.callFunction({
        name: "rank",
        data: {
          action: "upload",
          payload,
        },
      });
      wx.hideLoading();
      wx.showToast({ title: "已上传排行榜", icon: "success" });
      this.fetchRank();
    } catch (e) {
      wx.hideLoading();
      console.error("rank upload error:", e);
      wx.showToast({ title: "上传失败，请稍后重试", icon: "none" });
    }
  },
});

