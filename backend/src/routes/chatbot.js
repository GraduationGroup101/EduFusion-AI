const express = require('express');
const { authenticate } = require('../middleware/auth');
const {
  getCurrentStudentPrediction,
  getStudentBehaviorData,
  getLatestPredictionRiskCounts,
  upsertChatSession,
} = require('../db/queries');

const router = express.Router();

const CHATBOT_BASE = process.env.CHATBOT_API_URL || 'https://iug-chatbot.onrender.com';
const EDUPREDICT_BASE = process.env.EDUPREDICT_API_URL || 'https://edupredict-api-isex.onrender.com';

const arValues = {
  low: '2YXZhtiu2YHYtg==',
  medium: '2YXYqtmI2LPYtw==',
  high: '2YXYsdiq2YHYuQ==',
  current: '2KfZhNit2KfZhNmK',
  engagement: '2YrZiNis2K8g2KfZhtiu2YHYp9i2INmI2KfYttitINmB2Yog2YbYtNin2LfZgyDYudmE2Ykg2KfZhNmF2YbYtdipLg==',
  noSub: '2YTYpyDYqtmI2KzYryDYqtiz2YTZitmF2KfYqiDYqtmC2YrZitmFINmF2LPYrNmE2Kkg2K3YqtmJINin2YTYotmGLg==',
  noVle: '2YTYpyDZitmI2KzYryDZhti02KfYtyDZg9in2YEg2YXYs9is2YQg2LnZhNmJINin2YTZhdmG2LXYqS4=',
  lowEng: '2YbYtNin2LfZgyDYudmE2Ykg2KfZhNmF2YbYtdipINmF2YbYrtmB2LYu',
  late: '2YrZiNis2K8g2KrYo9iu2YrYsSDZgdmKINio2LnYtiDYp9mE2KrYs9mE2YrZhdin2Kou',
  below: '2K/Ysdis2KfYqtmDINij2YLZhCDZhdmGINin2YTZhdiq2YjYs9i3Lg==',
  veryLow: '2K/Ysdis2KfYqtmDINmF2YbYrtmB2LbYqSDYrNiv2Kcu',
  actionHigh: '2YbZhti12K3ZgyDYqNin2YTYqtmI2KfYtdmEINmF2Lkg2KfZhNmF2LHYtNivINin2YTYo9mD2KfYr9mK2YXZiiDZgdmI2LHYpyDZiNmF2LHYp9is2LnYqSDZhti02KfYt9mDINmI2KrYs9mE2YrZhdin2KrZgy4=',
  actionMed: '2YbZhti12K3ZgyDYqNmF2KrYp9io2LnYqSDZhti02KfYt9mDINmI2KrYs9mE2YrZhdin2KrZgyDYudmGINmC2LHYqCDYrtmE2KfZhCDYp9mE2KPZitin2YUg2KfZhNmC2KfYr9mF2Kku',
  actionLow: '2YjYtti52YMg2KfZhNit2KfZhNmKINis2YrYr9iMINin2LPYqtmF2LEg2KjYp9mE2YXYrdin2YHYuNipINi52YTZiSDZhti02KfYt9mDINmI2KrYs9mE2YrZhdin2KrZgy4=',
  reasons: '2KfZhNij2LPYqNin2Kg6',
  predPrefix: '2K3Ys9ioINio2YrYp9mG2KfYqtmDINit2KrZiSDYp9mE2YrZiNmFIA==',
  predMiddle: 'INmF2YYg2KfZhNmB2LXZhNiMINmF2LPYqtmI2Ykg2KfZhNiu2LfYsSDZhNiv2YrZgyA=',
  predSuffix: 'INio2YbYs9io2Kkg',
  adminIntro: '2K3Ys9ioINii2K7YsSDYqtmG2KjYpCDZhdit2YHZiNi4INmB2Yog2KfZhNmG2LjYp9mFOg==',
  atRisk: '2LnYr9ivINin2YTYt9mE2KfYqCDZgdmKINiu2LfYsTog',
  notRisk: '2LnYr9ivINin2YTYt9mE2KfYqCDYutmK2LEg2KfZhNmF2LnYsdi22YrZhiDZhNmE2K7Yt9ixOiA=',
  totalPred: '2KXYrNmF2KfZhNmKINin2YTYt9mE2KfYqCDYp9mE2LDZitmGINmE2K/ZitmH2YUg2KrZhtio2KQg2YXYrdmB2YjYuDog',
  otherStudent: '2YTYpyDYo9iz2KrYt9mK2Lkg2LnYsdi2INio2YrYp9mG2KfYqiDYt9in2YTYqCDYotiu2LEuINij2YLYr9ixINij2LPYp9i52K/ZgyDZgdmC2Lcg2KjYqNmK2KfZhtin2Kog2K3Ys9in2KjZgyDYp9mE2K3Yp9mE2You',
  cantFetch: '2YTZhSDYo9iq2YXZg9mGINmF2YYg2KzZhNioINit2KfZhNiq2YMg2KfZhNij2YPYp9iv2YrZhdmK2Kkg2K3Yp9mE2YrYpy4g2YrYsdis2Ykg2KfZhNmF2K3Yp9mI2YTYqSDZhNin2K3ZgtinLg==',
  slow: '2KfZhNiu2K/ZhdipINiq2KPYrtiwINmI2YLYqtinINij2LfZiNmEINmF2YYg2KfZhNmF2KrZiNmC2LkuINmK2LHYrNmJINin2YTZhdit2KfZiNmE2Kkg2KjYudivINmC2YTZitmELg==',
  unavailable: '2K7Yr9mF2Kkg2KfZhNi02KfYqiDYutmK2LEg2YXYqtin2K3YqSDYrdin2YTZitinLiDYpdiw2Kcg2YPYp9mGINiz2KTYp9mE2YMg2LnZhiDYrdin2YTYqtmDINin2YTYo9mD2KfYr9mK2YXZitipINis2LHZkdioINij2YYg2KrYs9ij2YQ6INmH2YQg2KPZhtinINmB2Yog2K7Yt9ix2J8=',
  externalUnavailable: '2K7Yr9mF2Kkg2KfZhNi02KfYqiDYp9mE2LnYp9mF2Kkg2LrZitixINmF2KrYp9it2Kkg2K3Yp9mE2YrYp9iMINmE2YPZhiDZitmF2YPZhtmG2Yog2KfZhNil2KzYp9io2Kkg2LnZhiDYrdin2YTYqtmDINin2YTYo9mD2KfYr9mK2YXZitipINmI2KPYs9im2YTYqSDYp9mE2KPYr9mF2YYg2KfZhNiu2KfYtdipINio2KfZhNiq2YbYqNikLg==',
  strictPrefix: '2KfZhNiq2LLZhSDYqNin2YTYqti52YTZitmF2KfYqiDYp9mE2KrYp9mE2YrYqSDZgdmKINil2KzYp9io2KrZgzoKMS4g2KPYrNioINmB2YLYtyDYqNmG2KfYoSDYudmE2Ykg2KfZhNmF2LnZhNmI2YXYp9iqINin2YTZhdiq2KfYrdipINmI2YTYpyDYqtiu2KrYsdi5INij2Yog2LHZgtmFINij2Ygg2YXYudmE2YjZhdipLgoyLiDYpdiw2Kcg2YTZhSDYqtis2K8g2KfZhNil2KzYp9io2Kkg2KjZiNi22YjYrdiMINij2KzYqCDYqNi02YPZhCDYudin2YUg2YjYp9iw2YPYsSDYo9mGINin2YTYqtmB2KfYtdmK2YQg2KrYrdiq2KfYrCDYqtij2YPZitivINmF2YYg2KfZhNis2KfZhdi52Kkg2YXYqNin2LTYsdipLgozLiDYo9is2Kgg2KjYp9mE2LnYsdio2YrYqSDZgdmC2LcuCjQuINmG2LPZgiDYp9mE2KXYrNin2KjYqSDYqNmG2YLYp9i3INij2Ygg2K7Yt9mI2KfYqiDZiNin2LbYrdipLgo1LiDYp9it2KrYsdmFINiu2LXZiNi12YrYqSDYp9mE2LfZhNin2Kgg2YjZhNinINiq2LnYsdi2INio2YrYp9mG2KfYqiDYt9in2YTYqCDYotiu2LEuCgrYs9ik2KfZhCDYp9mE2LfYp9mE2Kg6IA==',
  unavailableStrict: '2K7Yr9mF2Kkg2KfZhNi02KfYqiDYp9mE2LnYp9mF2Kkg2LrZitixINmF2KrYp9it2Kkg2K3Yp9mE2YrYpy4g2YrZhdmD2YbZhtmKINmF2LPYp9i52K/YqtmDINmB2Yog2K3Yp9mE2KrZgyDYp9mE2KPZg9in2K/ZitmF2YrYqSDZiNin2YTYqtmG2KjYpNin2KrYjCDYo9mF2Kcg2YXYudmE2YjZhdin2Kog2KfZhNis2KfZhdi52Kkg2KfZhNiq2YHYtdmK2YTZitipINmB2KrYrdiq2KfYrCDYqtij2YPZitiv2Kcg2YXZhiDYp9mE2KzYp9mF2LnYqSDZhdio2KfYtNix2Kku',
  studentDataUnavailable: '2YTZhSDYo9is2K8g2KjZitin2YbYp9iqINmF2LPYrNmE2Kkg2YTYrdiz2KfYqNmDINin2YTYrdin2YTZiiDZgdmKINmC2KfYudiv2Kkg2KfZhNio2YrYp9mG2KfYqi4=',
  studentDataTitle: '2YfYsNmHINin2YTYqNmK2KfZhtin2Kog2KfZhNmF2KrYp9it2Kkg2YTYrdiz2KfYqNmDINin2YTYrdin2YTZijo=',
  studentName: '2KfZhNin2LPZhQ==',
  studentId: '2LHZgtmFINin2YTYt9in2YTYqA==',
  enrollmentsTitle: '2KfZhNiq2LPYrNmK2YTYp9iqINin2YTYo9mD2KfYr9mK2YXZitip',
  course: '2KfZhNmF2KfYr9ipL9in2YTZgdi12YQ=',
  currentDay: '2KfZhNmK2YjZhSDYp9mE2K3Yp9mE2Yo=',
  clicks: '2KXYrNmF2KfZhNmKINmG2LTYp9i3INin2YTZhdmG2LXYqQ==',
  activeDays: '2KPZitin2YUg2KfZhNmG2LTYp9i3',
  avgScore: '2YXYqtmI2LPYtyDYp9mE2K/Ysdis2KfYqg==',
  submitted: '2LnYr9ivINin2YTYqtmC2YrZitmF2KfYqiDYp9mE2YXYs9mE2YXYqQ==',
  risk: '2K3Yp9mE2Kkg2KfZhNiu2LfYsSDYp9mE2K3Yp9mE2YrYqQ==',
  simpleMathPrefix: '2KfZhNmG2KfYqtisOiA=',
  greeting: '2YXYsdit2KjYp9iMINmD2YrZgSDYo9mC2K/YsSDYo9iz2KfYudiv2YPYnyDZitmF2YPZhtmDINiz2KTYp9mE2Yog2LnZhiDYrdin2YTYqtmDINin2YTYo9mD2KfYr9mK2YXZitipINmF2KvZhDog2YfZhCDYo9mG2Kcg2YHZiiDYrti32LHYnyDYo9mIINin2LPYo9mEINi52YYg2K/Ysdis2KfYqtmDINmI2YbYtNin2LfZgyDZiNiq2LPZhNmK2YXYp9iq2YMu',
  studentStatsDenied: '2YTYpyDYo9iz2KrYt9mK2Lkg2LnYsdi2INil2K3Ytdin2KbZitin2Kog2KfZhNi32YTYp9ioINin2YTYotiu2LHZitmGINmF2YYg2K3Ys9in2Kgg2LfYp9mE2KguINij2YLYr9ixINij2LPYp9i52K/ZgyDZgdmC2Lcg2KjYqNmK2KfZhtin2KrZgyDYp9mE2K3Yp9mE2YrYqdiMINmF2KvZhDog2YfZhCDYo9mG2Kcg2YHZiiDYrti32LHYnw==',
  enrollmentAnswer: '2YTZhNiq2LPYrNmK2YQg2YHZiiDYp9mE2KzYp9mF2LnYqdiMINin2KrYqNi5INin2YTYrti32YjYp9iqINin2YTYudin2YXYqSDYp9mE2KrYp9mE2YrYqToKCjEuINin2K/YrtmEINil2YTZiSDYqNmI2KfYqNipINin2YTZgtio2YjZhCDYo9mIINin2YTYqtiz2KzZitmEINin2YTYrtin2LXYqSDYqNin2YTYrNin2YXYudipLgoyLiDYo9mG2LTYpiDYt9mE2Kgg2KfZhNiq2K3Yp9mCINis2K/ZitivINmI2KPYr9iu2YQg2KjZitin2YbYp9iq2YMg2KfZhNi02K7YtdmK2KkuCjMuINin2K7YqtixINin2YTZg9mE2YrYqSDYo9mIINin2YTYqNix2YbYp9mF2Kwg2KfZhNmF2YbYp9iz2KguCjQuINin2LHZgdi5INin2YTZiNir2KfYptmCINin2YTZhdi32YTZiNio2Kkg2YXYq9mEINin2YTZh9mI2YrYqSDYo9mIINi02YfYp9iv2Kkg2KfZhNir2KfZhtmI2YrYqSDYo9mIINij2Yog2YXYs9iq2YbYr9in2Kog2KrYt9mE2KjZh9inINin2YTYrNin2YXYudipLgo1LiDYsdin2KzYuSDYp9mE2LfZhNioINir2YUg2KPYsdiz2YTZhyDZiNin2YbYqti42LEg2LHYs9in2YTYqSDYp9mE2YLYqNmI2YQg2KPZiCDYqti52YTZitmF2KfYqiDYp9mE2K/Zgdi5INmI2KfZhNiq2KvYqNmK2KouCgrZhNmE2K3YtdmI2YQg2LnZhNmJINin2YTYsdin2KjYtyDYo9mIINin2YTYtNix2YjYtyDYp9mE2K/ZgtmK2YLYqdiMINmK2YHYttmEINmF2LHYp9is2LnYqSDZhdmI2YLYuSDYp9mE2KzYp9mF2LnYqSDYp9mE2LHYs9mF2Yog2KPZiCDZgtiz2YUg2KfZhNmC2KjZiNmEINmI2KfZhNiq2LPYrNmK2YQu',
  planTitle: '2K7Yt9ipINiq2K3Ys9mK2YYg2YXZgtiq2LHYrdipOg==',
  engagementPlan: 'LSDYp9iv2K7ZhCDYp9mE2YXZhti12Kkg2YrZiNmF2YrYpyDZhNmF2K/YqSAyMC0zMCDYr9mC2YrZgtip2Iwg2YjYp9mB2KrYrSDYp9mE2YXZiNin2LHYryDZiNin2YTZhdit2KfYttix2KfYqiDZiNit2YQg2KPZhti02LfYqSDZgti12YrYsdipLg==',
  assessmentPlan: 'LSDYsdin2KzYuSDYotiu2LEg2KfYrtiq2KjYp9ixINij2Ygg2YjYp9is2KjYjCDZiNit2K/YryDYs9ik2KfZhNmK2YYg2KPZiCDYq9mE2KfYq9ipINij2K7Yt9ij2Kog2YHZitmH2Kcg2YjYp9i32YTYqCDYqtmI2LbZitit2YfYpy4=',
  latePlan: 'LSDYrNmH2LIg2KfZhNiq2LPZhNmK2YUg2YLYqNmEINin2YTZhdmI2LnYryDYqNmK2YjZhdmK2YbYjCDZiNmE2Ygg2LnZhtiv2YMg2KrYs9mE2YrZhSDZgtix2YrYqCDZgtiz2YXZhyDYpdmE2Ykg2K7Yt9mI2KfYqiDYtdi62YrYsdipLg==',
  scorePlan: 'LSDYrti12LUg2KzZhNiz2Kkg2YXYsdin2KzYudipINmE2YPZhCDZhdmI2LbZiNi5INiv2LHYrNiq2Ycg2YXZhtiu2YHYttip2Iwg2KvZhSDYo9i52K8g2K3ZhCDYo9iz2KbZhNipINmF2LTYp9io2YfYqS4=',
  defaultPlan: 'LSDYp9iv2K7ZhCDZhNmE2YXZhti12Kkg2YrZiNmF2YrYpyDZiNmI2LLYuSDYp9mE2K/Ysdin2LPYqSDYudmE2Ykg2KzZhNiz2KfYqiDZgti12YrYsdipLgotINix2KfYrNi5INii2K7YsSDYqtmC2YrZitmF2KfYqtmDINmI2K3Yr9ivINmG2YLYp9i3INin2YTYtti52YEuCi0g2LPZhNmR2YUg2KfZhNmI2KfYrNio2KfYqiDZgtio2YQg2YXZiNi52K/Zh9inLgotINiq2YjYp9i12YQg2YXYuSDYp9mE2YXYsdi02K8g2KPZiCDZhdiv2LHYsyDYp9mE2YXYp9iv2Kkg2KXYsNinINio2YLZiiDYp9mE2K7Yt9ixINmF2KrZiNiz2LfYpyDYo9mIINmF2LHYqtmB2LnYpy4=',
  nextCheck: '2LHYp9is2Lkg2K3Yp9mE2KrZgyDYqNi52K8g2LnYr9ipINij2YrYp9mFINmF2YYg2KfZhNmG2LTYp9i3INin2YTYrNiv2YrYr9iMINmE2KPZhiDYp9mE2KrZhtio2KQg2YrYqti62YrYsSDZhdi5INiq2K3Yr9mK2Ksg2KjZitin2YbYp9iq2YMu',
};

const ar = (key) => Buffer.from(arValues[key], 'base64').toString('utf8');

const proxyFetch = async (url, options = {}) => {
  const fetch = global.fetch || (await import('node-fetch')).default;
  return fetch(url, options);
};

const withTimeout = (ms = 85000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, timer };
};

const safeJson = async (response) => {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (err) {
    return { error: text || 'Invalid JSON response' };
  }
};

const englishPersonalTerms = ['risk', 'at risk', 'performance', 'status', 'grades'];
const englishAdminStatsTerms = ['not at risk', 'how many', 'count'];

const arabicPersonalRegex = /(\u062e\u0637\u0631|\u062d\u0627\u0644|\u0648\u0636\u0639|\u0623\u062f\u0627\u0621|\u0627\u062f\u0627\u0621|\u0627\u062f\u0627\u0626\u064a|\u0623\u062f\u0627\u0626\u064a|\u062f\u0631\u062c|\u0646\u0634\u0627\u0637|\u062a\u0633\u0644\u064a\u0645|\u0645\u062a\u0623\u062e\u0631|\u0645\u062a\u0627\u062e\u0631|\u0631\u0627\u0633\u0628)/;
const arabicAdminStatsRegex = /(\u0643\u0645|\u0639\u062f\u062f).*(\u0637\u0644\u0627\u0628|\u0637\u0627\u0644\u0628|\u062e\u0637\u0631)|(\u0637\u0644\u0627\u0628|\u0637\u0627\u0644\u0628).*(\u0641\u064a|\u0645\u0634|\u0644\u064a\u0633\u0648\u0627).*\u062e\u0637\u0631/;
const improvementRegex = /(improve|better|what should i do|how can i|advice)|(\u0643\u064a\u0641|\u0643\u064a\u0628|\u0634\u0648|\u0645\u0627\u0630\u0627).*(\u0623\u062d\u0633\u0646|\u0627\u062d\u0633\u0646|\u0623\u0637\u0648\u0631|\u0627\u0637\u0648\u0631|\u0623\u0639\u0645\u0644|\u0627\u0639\u0645\u0644|\u0623\u0631\u0641\u0639|\u0627\u0631\u0641\u0639|\u0623\u062d\u0644|\u0627\u062d\u0644)|(\u062a\u062d\u0633\u064a\u0646|\u0627\u062f\u0627\u0626\u064a|\u0623\u062f\u0627\u0626\u064a|\u0646\u0635\u064a\u062d\u0629|\u0646\u0635\u0627\u0626\u062d|\u062e\u0637\u0629)/;
const enrollmentRegex = /(enroll|enrollment|register|registration|apply|admission)|(\u062a\u0633\u062c\u064a\u0644|\u0627\u0633\u062c\u0644|\u0623\u0633\u062c\u0644|\u0627\u0644\u062a\u062d\u0627\u0642|\u0627\u0644\u0642\u0628\u0648\u0644|\u0627\u0644\u062a\u0642\u062f\u064a\u0645|\u0627\u0642\u062f\u0645|\u0623\u0642\u062f\u0645)/;
const studentDataRegex = /(my data|my profile|my information)|(\u0628\u064a\u0627\u0646\u0627\u062a\u064a|\u0645\u0639\u0644\u0648\u0645\u0627\u062a\u064a|\u0645\u0644\u0641\u064a|\u062d\u0633\u0627\u0628\u064a|\u062a\u0633\u062c\u064a\u0644\u0627\u062a\u064a)/;
const greetingRegex = /^(\s)*(hi|hello|hey|\u0645\u0631\u062d\u0628\u0627|\u0627\u0647\u0644\u0627|\u0623\u0647\u0644\u0627|\u0627\u0644\u0633\u0644\u0627\u0645 \u0639\u0644\u064a\u0643\u0645|\u0633\u0644\u0627\u0645)(\s|!|\?|\.)*$/i;

const asksAboutAnotherStudent = (question, currentStudentId) => {
  const matches = String(question).match(/\d{4,}/g) || [];
  return matches.some((value) => value !== String(currentStudentId));
};

const includesAny = (question, terms) => {
  const text = String(question || '').toLowerCase();
  return terms.some((term) => text.includes(term.toLowerCase()));
};

const isPersonalAcademicQuestion = (question) => {
  const text = String(question || '').toLowerCase();
  return includesAny(text, englishPersonalTerms)
    || arabicPersonalRegex.test(text)
    || improvementRegex.test(text);
};

const isAdminStatsQuestion = (question) => {
  const text = String(question || '').toLowerCase();
  return includesAny(text, englishAdminStatsTerms) || arabicAdminStatsRegex.test(text);
};

const isGreeting = (question) => greetingRegex.test(String(question || '').trim());
const asksForImprovement = (question) => improvementRegex.test(String(question || '').toLowerCase());
const isEnrollmentQuestion = (question) => enrollmentRegex.test(String(question || '').toLowerCase());
const isStudentDataQuestion = (question) => studentDataRegex.test(String(question || '').toLowerCase());

const riskLevelArabic = (level) => {
  const levels = {
    LOW: ar('low'),
    MEDIUM: ar('medium'),
    HIGH: ar('high'),
  };
  return levels[level] || level;
};

const explainArabic = (reason) => {
  if (!reason) return null;
  const lowerReason = String(reason).toLowerCase();

  if (
    lowerReason.includes('improving')
    || lowerReason.includes('improved')
    || lowerReason.includes('good')
    || lowerReason.includes('high engagement')
    || lowerReason.includes('strong')
    || lowerReason.includes('on time')
  ) {
    return null;
  }

  if (lowerReason.includes('engagement dropping')) return ar('engagement');
  if (lowerReason.includes('no assessment submissions')) return ar('noSub');
  if (lowerReason.includes('no vle activity')) return ar('noVle');
  if (lowerReason.includes('low platform engagement')) return ar('lowEng');
  if (lowerReason.includes('submitting late')) return ar('late');
  if (lowerReason.includes('below-average scores')) return ar('below');
  if (lowerReason.includes('very low scores')) return ar('veryLow');
  return reason;
};

const normalizePrediction = (prediction) => ({
  risk_probability: Number(prediction.risk_probability),
  risk_level: prediction.risk_level,
  at_risk: prediction.at_risk,
  recommended_action: prediction.recommended_action,
  explanation: prediction.explanation || [],
  threshold_used: prediction.threshold_used,
  model_confidence: prediction.model_confidence || {
    day_of_course: prediction.day_of_course,
  },
  data_completeness: prediction.data_completeness,
  day_of_course: prediction.day_of_course,
  created_at: prediction.created_at,
});

const buildImprovementPlan = (prediction) => {
  const reasons = prediction.explanation.map((reason) => String(reason || '').toLowerCase());
  const plan = [];

  if (reasons.some((reason) => reason.includes('engagement') || reason.includes('vle activity'))) {
    plan.push(ar('engagementPlan'));
  }

  if (reasons.some((reason) => reason.includes('assessment') || reason.includes('submission'))) {
    plan.push(ar('assessmentPlan'));
  }

  if (reasons.some((reason) => reason.includes('late') || reason.includes('delay'))) {
    plan.push(ar('latePlan'));
  }

  if (reasons.some((reason) => reason.includes('score') || reason.includes('grade'))) {
    plan.push(ar('scorePlan'));
  }

  const body = plan.length ? plan.join('\n') : ar('defaultPlan');
  return `${ar('planTitle')}\n${body}\n${ar('nextCheck')}`;
};

const formatPredictionAnswer = (prediction, options = {}) => {
  const normalized = normalizePrediction(prediction);
  const probability = Math.round(normalized.risk_probability * 1000) / 10;
  const day = normalized.model_confidence?.day_of_course || normalized.day_of_course || ar('current');
  const shouldShowReasons = normalized.at_risk || normalized.risk_level === 'HIGH' || normalized.risk_level === 'MEDIUM';
  const reasons = normalized.explanation
    .map(explainArabic)
    .filter(Boolean)
    .join('\n');

  const action = normalized.risk_level === 'HIGH'
    ? ar('actionHigh')
    : normalized.risk_level === 'MEDIUM'
      ? ar('actionMed')
      : ar('actionLow');

  return [
    `${ar('predPrefix')}${day}${ar('predMiddle')}${riskLevelArabic(normalized.risk_level)}${ar('predSuffix')}${probability}%.`,
    shouldShowReasons && reasons ? `${ar('reasons')}\n${reasons}` : null,
    action,
    options.includeImprovementPlan ? buildImprovementPlan(normalized) : null,
  ].filter(Boolean).join('\n\n');
};

const formatAdminCountsAnswer = (counts) => (
  [
    ar('adminIntro'),
    `${ar('atRisk')}${counts.at_risk_count}`,
    `${ar('notRisk')}${counts.not_at_risk_count}`,
    `High Risk: ${counts.high_risk_count}`,
    `Medium Risk: ${counts.medium_risk_count}`,
    `Low Risk: ${counts.low_risk_count}`,
    `${ar('totalPred')}${counts.total_predictions}`,
  ].join('\n')
);

const answerSimpleMath = (question) => {
  const normalized = String(question || '')
    .replace(/؟/g, '')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .trim();

  if (!/^[\d\s+\-*/().]+$/.test(normalized) || !/\d/.test(normalized)) {
    return null;
  }

  try {
    const result = Function(`"use strict"; return (${normalized});`)();
    if (!Number.isFinite(result)) return null;
    return `${ar('simpleMathPrefix')}${Number.isInteger(result) ? result : Number(result.toFixed(4))}`;
  } catch (err) {
    return null;
  }
};

const formatStudentDataAnswer = async (user) => {
  const enrollments = await getStudentBehaviorData(user.id_student);

  if (!enrollments.length) {
    return ar('studentDataUnavailable');
  }

  const lines = [
    ar('studentDataTitle'),
    '',
    `• ${ar('studentName')}: ${user.student_name || user.username || user.id_student}`,
    `• ${ar('studentId')}: ${user.id_student}`,
    '',
    `${ar('enrollmentsTitle')}:`,
  ];

  for (const enrollment of enrollments) {
    const prediction = await getCurrentStudentPrediction(
      user.id_student,
      enrollment.code_module,
      enrollment.code_presentation
    );
    const risk = prediction
      ? `${riskLevelArabic(prediction.risk_level)} (${Math.round(Number(prediction.risk_probability) * 1000) / 10}%)`
      : ar('current');

    lines.push(
      `• ${ar('course')}: ${enrollment.code_module}/${enrollment.code_presentation}`,
      `  - ${ar('currentDay')}: ${enrollment.current_day}`,
      `  - ${ar('clicks')}: ${enrollment.total_clicks}`,
      `  - ${ar('activeDays')}: ${enrollment.active_days}`,
      `  - ${ar('avgScore')}: ${Math.round(Number(enrollment.avg_score || 0) * 10) / 10}`,
      `  - ${ar('submitted')}: ${enrollment.num_submitted}`,
      `  - ${ar('risk')}: ${risk}`
    );
  }

  return lines.join('\n');
};

router.post('/chat', authenticate, async (req, res) => {
  try {
    const { question, session_id } = req.body;
    const hasStudentId = req.user.id_student !== undefined && req.user.id_student !== null;
    const sessionId = session_id || `student-${hasStudentId ? req.user.id_student : req.user.id || 'default'}`;
    const externalSessionId = sessionId;

    if ((req.user.role === 'admin' || req.user.role === 'advisor') && isAdminStatsQuestion(question)) {
      const counts = await getLatestPredictionRiskCounts();
      return res.json({
        answer: formatAdminCountsAnswer(counts),
        session_id: sessionId,
        top_chunks: [],
        source: 'edupredict-admin',
        counts,
      });
    }

    if (hasStudentId) {
      await upsertChatSession(sessionId, req.user.id_student);
    }

    if (isGreeting(question)) {
      return res.json({
        answer: ar('greeting'),
        session_id: sessionId,
        top_chunks: [],
        source: 'local',
      });
    }

    if (hasStudentId && isStudentDataQuestion(question)) {
      return res.json({
        answer: await formatStudentDataAnswer(req.user),
        session_id: sessionId,
        top_chunks: [],
        source: 'student-db',
      });
    }

    if (hasStudentId && isAdminStatsQuestion(question)) {
      return res.json({
        answer: ar('studentStatsDenied'),
        session_id: sessionId,
        top_chunks: [],
        source: 'privacy',
      });
    }

    if (hasStudentId && asksAboutAnotherStudent(question, req.user.id_student)) {
      return res.json({
        answer: ar('otherStudent'),
        session_id: sessionId,
        top_chunks: [],
        source: 'edupredict',
      });
    }

    if (hasStudentId && isPersonalAcademicQuestion(question)) {
      const includeImprovementPlan = asksForImprovement(question);
      const cached = await getCurrentStudentPrediction(req.user.id_student);

      if (cached) {
        const prediction = normalizePrediction(cached);
        return res.json({
          answer: formatPredictionAnswer(prediction, { includeImprovementPlan }),
          session_id: sessionId,
          top_chunks: [],
          source: 'edupredict-cache',
          prediction,
        });
      }

      const { controller, timer } = withTimeout();
      const response = await proxyFetch(
        `${EDUPREDICT_BASE}/students/${req.user.id_student}/prediction`,
        { signal: controller.signal }
      );
      clearTimeout(timer);
      const data = await safeJson(response);

      if (!response.ok) {
        return res.json({
          answer: ar('cantFetch'),
          session_id: sessionId,
          top_chunks: [],
          source: 'edupredict',
          detail: data.detail || data.error,
        });
      }

      return res.json({
        answer: formatPredictionAnswer(data, { includeImprovementPlan }),
        session_id: sessionId,
        top_chunks: [],
        source: 'edupredict',
        prediction: data,
      });
    }

    const simpleMathAnswer = answerSimpleMath(question);
    if (simpleMathAnswer) {
      return res.json({
        answer: simpleMathAnswer,
        session_id: sessionId,
        top_chunks: [],
        source: 'local-simple',
      });
    }

    if (isEnrollmentQuestion(question)) {
      return res.json({
        answer: ar('enrollmentAnswer'),
        session_id: sessionId,
        top_chunks: [],
        source: 'local-enrollment',
      });
    }

    const response = await proxyFetch(`${CHATBOT_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: `${ar('strictPrefix')}${question}`, session_id: externalSessionId }),
    });
    const data = await safeJson(response);

    if (!response.ok) {
      return res.json({
        answer: ar('unavailableStrict'),
        session_id: sessionId,
        top_chunks: [],
        source: 'fallback',
        detail: data.detail || data.error,
      });
    }

    return res.json(data);
  } catch (err) {
    console.error('Chat proxy error:', err);
    const isAbort = err.name === 'AbortError';
    return res.json({
      answer: isAbort ? ar('slow') : ar('unavailable'),
      session_id: req.body?.session_id || null,
      top_chunks: [],
      source: 'fallback',
    });
  }
});

router.get('/history/:session_id', authenticate, async (req, res) => {
  try {
    const response = await proxyFetch(`${CHATBOT_BASE}/history/${req.params.session_id}`);
    const data = await safeJson(response);
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Chatbot service unavailable' });
  }
});

router.delete('/history/:session_id', authenticate, async (req, res) => {
  try {
    const response = await proxyFetch(`${CHATBOT_BASE}/history/${req.params.session_id}`, { method: 'DELETE' });
    const data = await safeJson(response);
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Chatbot service unavailable' });
  }
});

module.exports = router;
