// Wait for Firebase to be ready
async function waitForFirebase() {
    if (window.firebaseReady) return;
    return new Promise(resolve => {
        window.addEventListener('firebaseReady', resolve, { once: true });
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    
    console.log('DOM loaded, waiting for Firebase...');
    await waitForFirebase();
    console.log('Firebase ready, initializing app...');

    const { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } = window.firebaseImports.auth;
    const { doc, setDoc, getDoc, updateDoc, collection, addDoc, query, where, getDocs, deleteDoc } = window.firebaseImports.firestore;

    let debugOffsetDays = 0;

    const panel = document.getElementById('water-panel');

    document.getElementById('open-water-ui').addEventListener('click', () => {
        draftWater = 0;
        panel.classList.remove('hidden');
        syncWaterUI();
    });

    function getDateKey(date = new Date()) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    // ============ PAGE NAVIGATION ============
    const pages = document.querySelectorAll('.page');
    const navBtns = document.querySelectorAll('.nav-btn');

    function showPage(targetId) {
        pages.forEach(p => p.classList.remove('active'));
        navBtns.forEach(b => b.classList.remove('active'));
        document.getElementById(targetId).classList.add('active');
        const btn = document.querySelector(`.nav-btn[data-target="${targetId}"]`);
        if (btn) btn.classList.add('active');
    }

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => showPage(btn.dataset.target));
    });

    const profileShortcut = document.getElementById('profile-shortcut');
    profileShortcut.addEventListener('click', () => showPage('profile'));

    const slider = document.getElementById('water-slider');
    const fill = document.getElementById('water-fill');
    const amountText = document.getElementById('water-amount');

    let manualWater = 0;
    let draftWater = 0;

    slider.addEventListener("input", () => {
        draftWater = Number(slider.value);
        syncWaterUI();
    });

    // ============ IMAGE COMPRESSION ============
    function compressImage(file, maxWidth = 800) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    if (width > maxWidth) {
                        height = (height * maxWidth) / width;
                        width = maxWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // Compress to JPEG at 70% quality
                    resolve(canvas.toDataURL('image/jpeg', 0.7));
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // ============ AUTHENTICATION ============
    const signinForm = document.getElementById('signin-form');
    const signupForm = document.getElementById('signup-form');
    const userProfile = document.getElementById('user-profile');
    const showSignup = document.getElementById('show-signup');
    const showSignin = document.getElementById('show-signin');

    showSignup.addEventListener('click', (e) => {
        e.preventDefault();
        signinForm.style.display = 'none';
        signupForm.style.display = 'block';
    });

    showSignin.addEventListener('click', (e) => {
        e.preventDefault();
        signupForm.style.display = 'none';
        signinForm.style.display = 'block';
    });

    // Sign Up
    document.getElementById('signup').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('signup-name').value;
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;

    try {
        const userCredential = await createUserWithEmailAndPassword(window.auth, email, password);
        const user = userCredential.user;

        await setDoc(doc(window.db, 'users', user.uid), {
            name: name,
            email: email,
            age: null,
            sex: '',
            activityLevel: '',
            weight: null,
            height: null,
            dietaryRestrictions: '',
            healthConditions: '',
            fiberGoal: 30,
            probioticGoal: 5,
            waterGoal: 64,
            calorieGoal: 2000,
            createdAt: new Date()
        });

        alert('Account created successfully!');
    } catch (error) {
        alert('Error: ' + error.message);
    }
    });

    // Sign In
    document.getElementById('signin').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('signin-email').value;
        const password = document.getElementById('signin-password').value;

        try {
            await signInWithEmailAndPassword(window.auth, email, password);
        } catch (error) {
            alert('Error: ' + error.message);
        }
    });

    // Sign Out
    document.getElementById('signout-btn').addEventListener('click', async () => {
        try {
            await signOut(window.auth);
            window.mealsByDay = {};
            renderMeals();
            recalculateStats();
        } catch (error) {
            alert('Error: ' + error.message);
        }
    });

    // Update Profile Settings
    document.getElementById('profile-settings').addEventListener('submit', async (e) => {
        e.preventDefault();
        const user = window.auth.currentUser;
        if (!user) return;

        try {
            await updateDoc(doc(window.db, 'users', user.uid), {
                fiberGoal: parseInt(document.getElementById('fiber-goal').value),
                probioticGoal: parseInt(document.getElementById('probiotic-goal').value),
                waterGoal: parseInt(document.getElementById('water-goal').value) || 64,
                calorieGoal: parseInt(document.getElementById('calorie-goal').value) || 2000
            });
            alert('Goals updated successfully!');
        } catch (error) {
            alert('Error: ' + error.message);
        }
    });

    // ============ FIRESTORE FUNCTIONS ============
    async function saveMealToFirestore(meal) {
        const user = window.auth.currentUser;
        if (!user) return null;

        const date = new Date();
        date.setDate(date.getDate() + debugOffsetDays);
        const dateKey = getDateKey(date);

        const docRef = await addDoc(collection(window.db, 'meals'), {
            userId: user.uid,
            ...meal,
            dateKey: dateKey,
            createdAt: new Date()
        });

        return docRef.id;
    }

    async function loadUserMeals(userId) {
        const q = query(collection(window.db, 'meals'), where('userId', '==', userId));
        const querySnapshot = await getDocs(q);

        const mealsByDay = {};
        
        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();

            const day =
                normalizeDateKey(data.dateKey) ||
                getDateKey(data.createdAt?.toDate?.() || new Date());

            if (!mealsByDay[day]) {
                mealsByDay[day] = [];
            }

            mealsByDay[day].push({
                id: docSnap.id,
                ...data
            });
        });

        window.mealsByDay = mealsByDay;
        window.summariesByDay = buildSummariesFromMeals(mealsByDay);
        console.log("Loaded summaries:", window.summariesByDay);
        renderMeals();
        recalculateStats();
    }

    function buildSummariesFromMeals(mealsByDay) {
        const summaries = {};

        for (const day in mealsByDay) {
            const meals = mealsByDay[day];

            const fiber = meals.reduce((t, m) => t + (m.fiber || 0), 0);
            const water = meals.reduce((t, m) => t + (m.water || 0), 0);
            const fermented = meals.reduce((t, m) => t + (m.fermented || 0), 0);
            const veggies = meals.reduce((t, m) => t + (m.veggies || 0), 0);
            const sugar = meals.reduce((t, m) => t + (m.sugar || 0), 0);
            const processed = meals.reduce((t, m) => t + (m.processed || 0), 0);

            const score = calculateGutScore(
                fiber,
                water,
                fermented,
                veggies,
                sugar,
                processed
            );

            summaries[day] = {
                dateKey: day,
                gutScore: score
            };
        }

        return summaries;
    }

    async function deleteMealFromFirestore(mealId) {
        await deleteDoc(doc(window.db, 'meals', mealId));
    }

    async function saveDailySummary(userId, dateKey, stats, gutScore) {
        await setDoc(doc(window.db, 'daily-summaries', `${userId}-${dateKey}`), {
            userId,
            dateKey,
            ...stats,
            gutScore,
            updatedAt: new Date()
        });
    }
    
    // ================= WEEKLY CHALLENGE SYSTEM =================
console.log("Weekly Challenge JS Loaded");

// ---------- Daily Questions ----------
const dailyQuestions = [
    { question: "Which food is richest in prebiotics that feed beneficial gut bacteria?", options: ["White rice","Garlic and onions","Chicken breast","Olive oil"], correct: 1, explanation: "Garlic and onions contain inulin, a powerful prebiotic fiber that feeds beneficial bacteria in your gut." },
    { question: "What percentage of your immune system is located in your gut?", options: ["30%", "50%", "70%", "90%"], correct: 2, explanation: "About 70% of your immune system resides in your gut, making gut health crucial for overall immunity." },
    { question: "Which fermented food typically contains the most diverse probiotic strains?", options: ["Yogurt","Kefir","Kombucha","Pickles"], correct: 1, explanation: "Kefir typically contains 12+ different probiotic strains, more diverse than most other fermented foods." },
    { question: "How does fiber help your gut microbiome?", options: ["It kills harmful bacteria","It feeds beneficial bacteria","It absorbs toxins","It speeds digestion"], correct: 1, explanation: "Fiber acts as food for beneficial gut bacteria, which ferment it to produce short-chain fatty acids that support gut health." },
    { question: "Which neurotransmitter is primarily produced in the gut?", options: ["Dopamine","Adrenaline","Serotonin","Cortisol"], correct: 2, explanation: "About 90% of your body's serotonin is produced in the gut, highlighting the gut-brain connection." },
    { question: "What is the ideal daily fiber intake for optimal gut health?", options: ["10-15g","25-38g","50-60g","70-80g"], correct: 1, explanation: "Most health organizations recommend 25-38g of fiber daily, though many people consume far less." },
    { question: "Which factor most negatively impacts gut bacteria diversity?", options: ["Exercise","Antibiotics","Sleep","Water intake"], correct: 1, explanation: "While necessary when prescribed, antibiotics kill both harmful and beneficial bacteria, significantly reducing gut diversity." }
];

// ---------- Helpers ----------
function getTodayQuestionIndex() {
    const index = new Date().getDay();
    console.log("Today question index:", index);
    return index;
}

function getWeekKey() {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(),0,1);
    const weekNumber = Math.ceil((((now - startOfYear)/86400000)+startOfYear.getDay()+1)/7);
    const key = `week-${now.getFullYear()}-${weekNumber}`;
    console.log("Computed week key:", key);
    return key;
}

// ---------- Load Leaderboard ----------
async function loadLeaderboard() {
    console.log("loadLeaderboard() called");
    const leaderboardList = document.getElementById('leaderboard-list');
    if(!leaderboardList){
        console.error("Leaderboard element not found");
        return;
    }
    leaderboardList.innerHTML = '<div class="loading-message">Loading leaderboard...</div>';

    const currentUser = window.auth?.currentUser;
    if(!currentUser){
        console.log("User not signed in");
        leaderboardList.innerHTML='<div class="loading-message">Sign in to view leaderboard</div>';
        return;
    }

    const weekKey = getWeekKey();

    try {
        console.log("Querying Firestore for leaderboard...");
        const q = query(collection(window.db,'challenge-scores'), where('week','==',weekKey));
        const snapshot = await getDocs(q);
        console.log("Firestore query complete. Docs found:", snapshot.size);

        const scores = [];
        snapshot.forEach(docSnap => scores.push({ id: docSnap.id, ...docSnap.data() }));

        if(scores.length===0){
            console.log("No leaderboard entries found");
            leaderboardList.innerHTML='<div class="loading-message">No participants yet. Be the first!</div>';
            return;
        }

        scores.sort((a,b)=>b.score - a.score || b.correctAnswers - a.correctAnswers);
        leaderboardList.innerHTML='';

        scores.forEach((entry,index)=>{
            const rank = index+1;
            const isCurrentUser = entry.userId===currentUser.uid;
            let rankClass = rank===1?'gold':rank===2?'silver':rank===3?'bronze':'';

            const item = document.createElement('div');
            item.className=`leaderboard-item ${isCurrentUser?'current-user':''}`;
            item.innerHTML=`
                <div class="leaderboard-rank ${rankClass}">${rank}</div>
                <div class="leaderboard-avatar"><span class="material-icons">person</span></div>
                <div class="leaderboard-info">
                    <div class="leaderboard-name">${entry.userName||'Anonymous'}${isCurrentUser?' (You)':''}</div>
                    <div class="leaderboard-answers">${entry.correctAnswers}/${entry.totalAnswers} correct</div>
                </div>
                <div class="leaderboard-score">${entry.score}</div>
            `;
            leaderboardList.appendChild(item);
        });

    } catch(err){
        console.error("Error loading leaderboard:",err);
        leaderboardList.innerHTML='<div class="loading-message">Error loading leaderboard</div>';
    }
}

// ---------- Load Daily Question ----------
async function loadDailyQuestion(){
    console.log("loadDailyQuestion() called");
    const questionContent = document.getElementById('daily-question-content');
    if(!questionContent){
        console.error("Daily question element not found");
        return;
    }
    questionContent.innerHTML = '<div class="loading-message">Loading today\'s question...</div>';

    const user = window.auth?.currentUser;
    if(!user){
        console.log("User not signed in, cannot load question");
        questionContent.innerHTML='<div class="already-answered"><p>Please sign in to participate in the challenge.</p></div>';
        return;
    }

    const questionIndex = getTodayQuestionIndex();
    const question = dailyQuestions[questionIndex];
    const weekKey = getWeekKey();
    const todayKey = getDateKey(new Date());

    try {
        console.log("Checking if user has answered today's question...");
        const answerDoc = await getDoc(doc(window.db,'challenge-answers',`${user.uid}-${todayKey}`));
        if(answerDoc.exists()){
            console.log("User has already answered today");
            questionContent.innerHTML=`
                <div class="already-answered">
                    <span class="material-icons">check_circle</span>
                    <p><strong>You've completed today's challenge!</strong></p>
                    <p>Come back tomorrow for a new question.</p>
                </div>
            `;
            return;
        }

        questionContent.innerHTML=`
            <div class="question-card">
                <div class="question-text">${question.question}</div>
                <div class="question-options">
                    ${question.options.map((opt,i)=>`<button class="option-btn" data-index="${i}">${opt}</button>`).join('')}
                </div>
                <div id="question-feedback"></div>
            </div>
        `;

        const optionBtns = questionContent.querySelectorAll('.option-btn');
        if(optionBtns.length===0) console.warn("No option buttons found");

        optionBtns.forEach(btn=>{
            btn.addEventListener('click', async e=>{
                const selectedIndex=parseInt(e.target.dataset.index);
                const isCorrect = selectedIndex===question.correct;

                optionBtns.forEach(b=>b.disabled=true);
                optionBtns[question.correct].classList.add('correct');
                if(!isCorrect) e.target.classList.add('incorrect');

                const feedback=document.getElementById('question-feedback');
                feedback.className=`question-feedback ${isCorrect?'correct':'incorrect'}`;
                feedback.innerHTML=`<strong>${isCorrect?'✓ Correct!':'✗ Incorrect'}</strong>
                <div class="question-explanation">${question.explanation}</div>`;

                console.log("Saving answer...");
                await saveAnswer(user.uid,todayKey,weekKey,isCorrect);
                console.log("Reloading leaderboard after answer...");
                await loadLeaderboard();
            });
        });

    } catch(err){
        console.error("Error loading daily question:",err);
        questionContent.innerHTML='<div class="loading-message">Error loading question</div>';
    }
}

let questionHistory = [];

async function loadInfiniteQuestion() {
    const container = document.getElementById('daily-question-content');
    container.innerHTML = "Loading...";

    const res = await fetch('/api/generate-question', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history: questionHistory })
    });

    const q = await res.json();
    questionHistory.push(q.question);

    renderQuestion(q);
}

function renderQuestion(q) {
    const container = document.getElementById('daily-question-content');

    container.innerHTML = `
        <div class="question-card">
            <div class="question-text">${q.question}</div>
            <div class="question-options">
                ${q.options.map((opt, i) => `
                    <button class="option-btn" data-index="${i}">${opt}</button>
                `).join('')}
            </div>
            <div id="question-feedback"></div>
        </div>
    `;

    const buttons = container.querySelectorAll('.option-btn');

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const selected = parseInt(btn.dataset.index);
            const correct = q.correct;

            buttons.forEach(b => b.disabled = true);

            buttons[correct].classList.add('correct');
            if (selected !== correct) btn.classList.add('incorrect');

            const feedback = document.getElementById('question-feedback');
            feedback.innerHTML = `
                <strong>${selected === correct ? "✓ Correct" : "✗ Incorrect"}</strong>
                <div>${q.explanation}</div>
                <button id="next-question-btn">Next Question</button>
            `;

            document.getElementById('next-question-btn')
                .addEventListener('click', loadInfiniteQuestion);
        });
    });
}

// ---------- Save Answer ----------
async function saveAnswer(userId,date,weekKey,isCorrect){
    try{
        await setDoc(doc(window.db,'challenge-answers',`${userId}-${date}`),{userId,date,week:weekKey,isCorrect,timestamp:new Date()});
        const userDoc = await getDoc(doc(window.db,'users',userId));
        const userName = userDoc.exists()?userDoc.data().name:'Anonymous';

        const scoreRef = doc(window.db,'challenge-scores',`${userId}-${weekKey}`);
        const scoreDoc = await getDoc(scoreRef);

        if(scoreDoc.exists()){
            const data=scoreDoc.data();
            await updateDoc(scoreRef,{
                score: data.score+(isCorrect?10:2),
                correctAnswers: data.correctAnswers+(isCorrect?1:0),
                totalAnswers: data.totalAnswers+1
            });
        } else {
            await setDoc(scoreRef,{
                userId,userName,week:weekKey,
                score: isCorrect?10:2,
                correctAnswers: isCorrect?1:0,
                totalAnswers:1
            });
        }

        console.log("Answer saved successfully");

    } catch(err){
        console.error("Error saving answer:",err);
    }
}

// ---------- Challenge Timer ----------
function updateChallengeTimer(){
    const now=new Date();
    const nextSunday = new Date(now);
    nextSunday.setDate(now.getDate() + (7-now.getDay()) % 7);
    nextSunday.setHours(23,59,59,999);

    const timeRemaining = nextSunday - now;
    const days = Math.floor(timeRemaining/(1000*60*60*24));
    const hours = Math.floor((timeRemaining%(1000*60*60*24))/(1000*60*60));

    const timerEl=document.getElementById('time-remaining');
    if(timerEl) timerEl.textContent=`Resets in ${days}d ${hours}h`;
}

    function routeUser(user) {
    if (user) {
        showPage('dashboard'); // your main app page
    } else {
        showPage('profile'); // or 'signin' depending on your structure
    }
}
async function updateWaterToFirestore(amount) {
    const user = window.auth.currentUser;
    if (!user) return;

    await updateDoc(doc(window.db, 'users', user.uid), {
        manualWater: amount
    });
}
document.getElementById('close-water-ui').addEventListener('click', async () => {
    const user = window.auth.currentUser;
    if (!user) return;

    manualWater += draftWater;

    await updateDoc(doc(window.db, 'users', user.uid), {
        manualWater: manualWater
    });

    draftWater = 0;
    slider.value = 0;

    recalculateStats();
    panel.classList.add("hidden");
});
    // Auth State Observer
    onAuthStateChanged(window.auth, async (user) => {
    routeUser(user);
    if (user) {
        signinForm.style.display = 'none';
        signupForm.style.display = 'none';
        userProfile.style.display = 'block';

        const userDoc = await getDoc(doc(window.db, 'users', user.uid));
        const userData = userDoc.data();
        manualWater = userData.manualWater || 0;
        syncWaterUI();
        recalculateStats();

        // Header display
        document.getElementById('user-name-display').textContent = userData.name || 'User';
        document.getElementById('user-email-display').textContent = user.email;

        // Personal info
        document.getElementById('profile-name').value = userData.name || '';
        document.getElementById('profile-age').value = userData.age || '';
        document.getElementById('profile-sex').value = userData.sex || '';
        document.getElementById('profile-activity').value = userData.activityLevel || '';

        // Health metrics
        document.getElementById('profile-weight').value = userData.weight || '';
        document.getElementById('profile-height').value = userData.height || '';
        document.getElementById('profile-dietary').value = userData.dietaryRestrictions || '';
        document.getElementById('profile-conditions').value = userData.healthConditions || '';

        // Goals
        document.getElementById('fiber-goal').value = userData.fiberGoal || 30;
        document.getElementById('probiotic-goal').value = userData.probioticGoal || 5;
        document.getElementById('water-goal').value = userData.waterGoal || 64;
        document.getElementById('calorie-goal').value = userData.calorieGoal || 2000;

        await loadUserMeals(user.uid);
    } else {
        signinForm.style.display = 'block';
        signupForm.style.display = 'none';
        userProfile.style.display = 'none';
        sampleMeals.length = 0;
        renderMeals();
    }

    console.log("Auth state changed. User:", user ? user.email : "Not signed in");
    console.log("Loading challenge features...");

    document.getElementById('loading-screen').style.display = 'none';
    document.body.style.visibility = 'visible';

    await loadLeaderboard();
    await loadDailyQuestion();
    
    if (!window.challengeTimerInitialized) {
        updateChallengeTimer();
        setInterval(updateChallengeTimer, 60000);
        window.challengeTimerInitialized = true;
        console.log("Challenge timer initialized");
    }
    });

    document.getElementById('personal-info-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const user = window.auth.currentUser;
        if (!user) return;

        try {
            await updateDoc(doc(window.db, 'users', user.uid), {
                name: document.getElementById('profile-name').value,
                age: parseInt(document.getElementById('profile-age').value) || null,
                sex: document.getElementById('profile-sex').value,
                activityLevel: document.getElementById('profile-activity').value
            });
            
            // Update header display
            document.getElementById('user-name-display').textContent = document.getElementById('profile-name').value;
            
            alert('Personal information updated!');
        } catch (error) {
            alert('Error: ' + error.message);
        }
    });

    document.getElementById('health-metrics-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const user = window.auth.currentUser;
        if (!user) return;

        try {
            await updateDoc(doc(window.db, 'users', user.uid), {
                weight: parseInt(document.getElementById('profile-weight').value) || null,
                height: parseInt(document.getElementById('profile-height').value) || null,
                dietaryRestrictions: document.getElementById('profile-dietary').value,
                healthConditions: document.getElementById('profile-conditions').value
            });
            alert('Health metrics updated!');
        } catch (error) {
            alert('Error: ' + error.message);
        }
    });

    // ============ DASHBOARD LOGIC ============
    const gutCircle = document.getElementById('gut-score-circle');
    const ctx = gutCircle.getContext('2d');
    const gutScoreValue = document.getElementById('gut-score-value');
    const fiberFill = document.getElementById('fiber-progress');
    const waterFill = document.getElementById('water-progress');
    const fermentedFill = document.getElementById('fermented-progress');
    const veggiesFill = document.getElementById('veggies-progress');
    const sugarFill = document.getElementById('sugar-progress');
    const processedFill = document.getElementById('processed-progress');
    const mealsList = document.getElementById('meals-list');

    const sampleMeals = [];

    let fiber = 0;
    let water = 0;
    let fermented = 0;
    let veggies = 0;
    let sugar = 0;
    let processed = 0;
    let gutScore = 0;

    function calculateGutScore(F, W, R, V, S, P) {
        const fiberScore = Math.min((25/30) * F, 25);
        const waterScore = Math.min((15/64) * W, 15);
        const fermentedScore = Math.min((15/3) * R, 15);
        const veggiesScore = Math.min((15/5) * V, 15);
        const sugarPenalty = Math.min((25/50) * S, 25);
        const processedPenalty = Math.min((15/3) * P, 15);
        
        const score = Math.max(0, Math.min(100, 
            30 + fiberScore + waterScore + fermentedScore + veggiesScore - sugarPenalty - processedPenalty
        ));
        
        return Math.round(score);
    }

    function recalculateStats() {
        const todayKey = getDateKey(new Date());
        const todayMeals = (window.mealsByDay && window.mealsByDay[todayKey]) 
            ? window.mealsByDay[todayKey] 
            : [];

        fiber = todayMeals.reduce((total, meal) => total + (meal.fiber || 0), 0);
        water = todayMeals.reduce((total, meal) => total + (meal.water || 0), 0);
        fermented = todayMeals.reduce((total, meal) => total + (meal.fermented || 0), 0);
        veggies = todayMeals.reduce((total, meal) => total + (meal.veggies || 0), 0);
        sugar = todayMeals.reduce((total, meal) => total + (meal.sugar || 0), 0);
        processed = todayMeals.reduce((total, meal) => total + (meal.processed || 0), 0);
        
        const totalWater = water + manualWater;

        gutScore = calculateGutScore(fiber, totalWater, fermented, veggies, sugar, processed);
        
        updateProgressBars(totalWater);
        drawRings();

        if (window.auth?.currentUser) {
            saveDailySummary(window.auth.currentUser.uid, todayKey, {
                fiber,
                water: water + manualWater,
                fermented,
                veggies,
                sugar,
                processed
            }, gutScore);
        }

        console.log("TODAY KEY:", getDateKey(new Date()));
        console.log("TODAY MEALS:", window.mealsByDay?.[getDateKey(new Date())]);
        console.log("ALL KEYS:", Object.keys(window.mealsByDay || {}));
    }

    function normalizeDateKey(key) {
        if (!key) return null;
        if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;

        const parsed = new Date(key);
        if (!isNaN(parsed)) return getDateKey(parsed);

        return key;
    }

    async function loadDailySummaries(userId) {
        const q = query(
            collection(window.db, 'daily-summaries'),
            where('userId', '==', userId)
        );

        const snapshot = await getDocs(q);

        const summaries = [];
        snapshot.forEach(docSnap => {
            summaries.push(docSnap.data());
        });

        return summaries;
    }

    function updateProgressBars(totalWater) {
        fiberFill.style.width = (fiber / 30 * 100) + '%';
        waterFill.style.width = (totalWater / 64 * 100) + '%';
        fermentedFill.style.width = (fermented / 3 * 100) + '%';
        veggiesFill.style.width = (veggies / 5 * 100) + '%';
        sugarFill.style.width = (sugar / 25 * 100) + '%';
        processedFill.style.width = (processed / 3 * 100) + '%';
        
        document.getElementById('fiber-value').textContent = `${fiber} / 30g`;
        document.getElementById('water-value').textContent = `${totalWater} / 64 oz`;
        document.getElementById('fermented-value').textContent = `${fermented} / 3 servings`;
        document.getElementById('veggies-value').textContent = `${veggies} / 5 servings`;
        document.getElementById('sugar-value').textContent = `${sugar} / 25g`;
        document.getElementById('processed-value').textContent = `${processed} / 3 servings`;
    }

    function drawRings() {
        const center = gutCircle.width / 2;
        ctx.clearRect(0, 0, gutCircle.width, gutCircle.height);

        const rings = [
            { value: gutScore / 100, color: '#56c596', radius: 80, thickness: 15 },
            { value: fiber / 30, color: '#3282b8', radius: 70, thickness: 10 },
            { value: fermented / 3, color: '#0f4c75', radius: 60, thickness: 10 }
        ];

        rings.forEach(ring => {
            ctx.beginPath();
            ctx.arc(center, center, ring.radius, 0, 2 * Math.PI);
            ctx.lineWidth = ring.thickness;
            ctx.strokeStyle = '#e0e0e0';
            ctx.stroke();

            const end = -0.5 * Math.PI + ring.value * 2 * Math.PI;
            ctx.beginPath();
            ctx.arc(center, center, ring.radius, -0.5 * Math.PI, end);
            ctx.strokeStyle = ring.color;
            ctx.lineWidth = ring.thickness;
            ctx.lineCap = 'round';
            ctx.shadowBlur = 12;
            ctx.shadowColor = ring.color;
            ctx.stroke();
            ctx.shadowBlur = 0;
        });

        gutScoreValue.textContent = gutScore;
    }


    // ============ SCORE BREAKDOWN POPUP ============
    const circleContainer = document.querySelector('.circle-container');
    const scoreOverlay = document.getElementById('score-overlay');
    const scoreBreakdownPopup = document.getElementById('score-breakdown-popup');
    const closeBreakdownBtn = document.getElementById('close-breakdown-btn');

    function updateScoreBreakdown() {
        const fiberScore = Math.min((25/30) * fiber, 25);
        const totalWater = water + manualWater;
        const waterScore = Math.min((15/64) * totalWater, 15);
        const fermentedScore = Math.min((15/3) * fermented, 15);
        const veggiesScore = Math.min((15/5) * veggies, 15);
        const sugarPenalty = Math.min((25/50) * sugar, 25);
        const processedPenalty = Math.min((15/3) * processed, 15);
        
        document.getElementById('base-score').textContent = '30';
        document.getElementById('fiber-score').textContent = '+' + Math.round(fiberScore);
        document.getElementById('water-score').textContent = '+' + Math.round(waterScore);
        document.getElementById('fermented-score').textContent = '+' + Math.round(fermentedScore);
        document.getElementById('veggies-score').textContent = '+' + Math.round(veggiesScore);
        document.getElementById('sugar-penalty').textContent = '-' + Math.round(sugarPenalty);
        document.getElementById('processed-penalty').textContent = '-' + Math.round(processedPenalty);
        document.getElementById('total-score').textContent = gutScore;
    }

    circleContainer.addEventListener('click', () => {
        updateScoreBreakdown();
        scoreOverlay.style.display = 'block';
        scoreBreakdownPopup.style.display = 'block';
    });

    closeBreakdownBtn.addEventListener('click', () => {
        scoreOverlay.style.display = 'none';
        scoreBreakdownPopup.style.display = 'none';
    });

    scoreOverlay.addEventListener('click', () => {
        scoreOverlay.style.display = 'none';
        scoreBreakdownPopup.style.display = 'none';
    });

    function syncWaterUI() {
        const slider = document.getElementById("water-slider");
        const fill = document.getElementById("water-fill");
        const text = document.getElementById("water-amount");

        if (!slider || !fill || !text) return;

        slider.value = draftWater;

        const percent = (draftWater / 64) * 100;
        fill.style.height = percent + "%";

        text.textContent = `${draftWater} oz to add`;
    }

    // ============ RENDER MEALS ============
    function renderMeals() {
        mealsList.innerHTML = '';

        const mealsByDay = window.mealsByDay || {};

        const sortedDays = Object.keys(mealsByDay)
            .sort((a, b) => new Date(b) - new Date(a)); // newest first

        if (sortedDays.length === 0) {
            mealsList.innerHTML = `<p style="opacity:0.6;">No meals logged yet.</p>`;
            return;
        }

        const todayKey = getDateKey(new Date());

        sortedDays.forEach(day => {
            const isToday = day === todayKey;
            const dayGroup = document.createElement('div');
            dayGroup.className = 'meal-day-group';

            const score = window.summariesByDay?.[day]?.gutScore;

        dayGroup.innerHTML = `
            <div class="meal-day-title ${isToday ? 'today' : 'collapsed'}">
                ${day}
                ${score !== undefined ? `<canvas class="day-ring" id="ring-${day}"></canvas>` : ''}
                ${isToday ? '' : '<span class="expand-hint">▼</span>'}
            </div>
            <div class="meal-day-content ${isToday ? 'expanded' : 'collapsed'}"></div>
        `;

            const title = dayGroup.querySelector('.meal-day-title');
            const content = dayGroup.querySelector('.meal-day-content');

            if (!isToday) {
                title.addEventListener('click', () => {
                    const open = content.classList.toggle('expanded');
                    content.classList.toggle('collapsed', !open);
                });
            }

            mealsByDay[day].forEach((meal) => {
                const card = document.createElement('div');
                card.className = 'meal-card';

                card.innerHTML = `
                    <button class="delete-btn">&times;</button>
                    <img src="${meal.img}">
                    <div class="meal-info">
                        <span class="meal-name">${meal.name}</span>
                        <span>Fiber: ${meal.fiber}g</span>
                        <span>Water: ${meal.water}oz</span>
                        <span>Fermented: ${meal.fermented}</span>
                        <span>Veggies: ${meal.veggies}</span>
                        <span>Sugar: ${meal.sugar}g</span>
                        <span>Processed: ${meal.processed}</span>
                    </div>
                `;

                // delete logic
                card.querySelector('.delete-btn').addEventListener('click', async () => {
                    if (meal.id) {
                        await deleteMealFromFirestore(meal.id);
                    }

                    mealsByDay[day] = mealsByDay[day].filter(m => m.id !== meal.id);

                    if (mealsByDay[day].length === 0) {
                        delete mealsByDay[day];
                    }

                    recalculateStats();
                    renderMeals();
                });

                dayGroup.querySelector('.meal-day-content').appendChild(card);
            });
                    console.log("DAY:", day);
            console.log("SUMMARY:", window.summariesByDay);
            console.log("MATCH:", window.summariesByDay?.[day]);

            mealsList.appendChild(dayGroup);
            if (score !== undefined) {
                setTimeout(() => drawMiniRing(day, score), 0);
            }
        });
    }

    function drawMiniRing(day, score) {
        const canvas = document.getElementById(`ring-${day}`);
        if (!canvas) return;

        const ctx = canvas.getContext("2d");

        const size = 80;
        canvas.width = size;
        canvas.height = size;

        const center = size / 2;
        const radius = 28;
        const thickness = 8;

        ctx.clearRect(0, 0, size, size);

        // background ring
        ctx.beginPath();
        ctx.arc(center, center, radius, 0, 2 * Math.PI);
        ctx.lineWidth = thickness;
        ctx.strokeStyle = "#e0e0e0";
        ctx.stroke();

        // progress ring
        const end = -0.5 * Math.PI + (score / 100) * 2 * Math.PI;

        ctx.beginPath();
        ctx.arc(center, center, radius, -0.5 * Math.PI, end);
        ctx.strokeStyle =
            score > 80 ? "#56c596" :
            score > 50 ? "#f9a826" :
            "#ff5c5c";

        ctx.lineWidth = thickness;
        ctx.lineCap = "round";
        ctx.stroke();

        // center text
        ctx.fillStyle = "#333";
        ctx.font = "bold 14px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(score, center, center);
    }

    // ============ ADD MEAL FORM ============
    const addMealBtn = document.getElementById('add-meal-button');
    const addMealForm = document.getElementById('add-meal-form');
    const popupFormContainer = document.getElementById('add-meal-form-container');
    const overlay = document.getElementById('overlay');

    addMealBtn.addEventListener('click', function() {
        const user = window.auth.currentUser;
        if (!user) {
            alert('Please sign in to add meals');
            showPage('profile');
            return;
        }
        popupFormContainer.style.display = 'block';
        overlay.style.display = 'block';
    });

    overlay.addEventListener('click', function() {
        popupFormContainer.style.display = 'none';
        overlay.style.display = 'none';
    });

    addMealForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        popupFormContainer.style.display = 'none';
        overlay.style.display = 'none';
        
        const name_ = document.getElementById('meal-name').value;
        const fiber_ = parseInt(document.getElementById('fiber-content').value) || 0;
        const water_ = parseInt(document.getElementById('water-content').value) || 0;
        const fermented_ = parseInt(document.getElementById('fermented-content').value) || 0;
        const veggies_ = parseInt(document.getElementById('veggies-content').value) || 0;
        const sugar_ = parseInt(document.getElementById('sugar-content').value) || 0;
        const processed_ = parseInt(document.getElementById('processed-content').value) || 0;
        const fileInput = document.getElementById('meal-image');
        
        let img_ = 'https://via.placeholder.com/150';
        
        if (fileInput.files && fileInput.files[0]) {
            img_ = await compressImage(fileInput.files[0]);
        }
        
        const newMeal = { 
            name: name_, 
            fiber: fiber_,
            water: water_,
            fermented: fermented_,
            veggies: veggies_,
            sugar: sugar_,
            processed: processed_,
            img: img_ 
        };
        
        const mealId = await saveMealToFirestore(newMeal);
        newMeal.id = mealId;
        
        const date = new Date();
        date.setDate(date.getDate() + debugOffsetDays);
        const dateKey = getDateKey(date);
        newMeal.dateKey = dateKey;

        if (!window.mealsByDay) window.mealsByDay = {};
        if (!window.mealsByDay[dateKey]) window.mealsByDay[dateKey] = [];

        window.mealsByDay[dateKey].push(newMeal);
        recalculateStats();
        renderMeals();
        
        addMealForm.reset();
    });

    // ============ BARCODE LOOKUP ============
    const lookupBtn = document.getElementById('lookup-barcode-btn');
    const barcodeInput = document.getElementById('barcode-input');

    lookupBtn.addEventListener('click', async () => {
        const barcode = barcodeInput.value.trim();
        
        if (!barcode) {
            alert('Please enter a barcode');
            return;
        }
        
        lookupBtn.textContent = 'Loading...';
        lookupBtn.disabled = true;
        
        try {
            const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
            const data = await response.json();
            
            if (data.status === 1) {
                const product = data.product;
                
                document.getElementById('meal-name').value = product.product_name || '';
                document.getElementById('fiber-content').value = Math.round(product.nutriments.fiber_100g || 0);
                const addedSugar = product.nutriments.added_sugars_100g ?? 0;
                document.getElementById('sugar-content').value = Math.round(addedSugar);
                document.getElementById('water-content').value = 0;
                document.getElementById('fermented-content').value = 0;
                document.getElementById('veggies-content').value = 0;
                document.getElementById('processed-content').value = 0;
                
                alert('Product found! Review and adjust values as needed.');
            } else {
                alert('Product not found in database. Please enter manually.');
            }
        } catch (error) {
            alert('Error looking up barcode. Please try again.');
            console.error(error);
        } finally {
            lookupBtn.textContent = 'Lookup';
            lookupBtn.disabled = false;
        }
    });

    // ============ BARCODE SCANNING ============
    const scanBtn = document.getElementById('scan-barcode-btn');
    const scannerContainer = document.getElementById('barcode-scanner');
    const stopScanBtn = document.getElementById('stop-scan-btn');
    let isScanning = false;

    scanBtn.addEventListener('click', () => {
        scannerContainer.style.display = 'block';
        isScanning = true;
        
        Quagga.init({
            inputStream: {
                name: "Live",
                type: "LiveStream",
                target: document.querySelector('#scanner-container'),
                constraints: {
                    width: 640,
                    height: 480,
                    facingMode: "environment"
                }
            },
            decoder: {
                readers: [
                    "ean_reader",
                    "ean_8_reader",
                    "upc_reader",
                    "upc_e_reader",
                    "code_128_reader",
                    "code_39_reader"
                ],
                multiple: false
            },
            locate: true,
            locator: {
                patchSize: "medium",
                halfSample: true
            },
            numOfWorkers: 4,
            frequency: 10
        }, function(err) {
            if (err) {
                console.error("Quagga initialization failed:", err);
                alert("Camera access failed. Please ensure camera permissions are granted.");
                scannerContainer.style.display = 'none';
                return;
            }
            Quagga.start();
        });
        
        Quagga.onDetected(onBarcodeDetected);
    });

    function onBarcodeDetected(result) {
        if (!isScanning) return;
        
        const code = result.codeResult.code;
        barcodeInput.value = code;
        
        Quagga.stop();
        isScanning = false;
        scannerContainer.style.display = 'none';
        
        lookupBtn.click();
    }

    stopScanBtn.addEventListener('click', () => {
        if (isScanning) {
            Quagga.stop();
            isScanning = false;
            scannerContainer.style.display = 'none';
        }
    });

    // Initialize with empty state
    renderMeals();
    recalculateStats();

    // AI Suggestions Feature
//const getAISuggestionsBtn = document.getElementById('get-ai-suggestions-btn');
//const aiSuggestionsResult = document.getElementById('ai-suggestions-result');


    // ============ AI CHATBOT ============
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const quickActionBtns = document.querySelectorAll('.quick-action-btn');

// Auto-resize textarea
chatInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = this.scrollHeight + 'px';
});

async function getUserProfile() {
    const user = window.auth.currentUser;
    if (!user) return {};
    
    const userDoc = await getDoc(doc(window.db, 'users', user.uid));
    return userDoc.data() || {};
}

// Get user context for AI
async function getUserContext() {
    const user = window.auth.currentUser;
    if (!user) return "User not signed in.";
    
    const profile = await getUserProfile();
    const allMeals = Object.values(window.mealsByDay || {}).flat();
    const recentMeals = allMeals.slice(-3).map(m => m.name).join(', ') || 'None yet';
    
    return `User Profile:
- Name: ${profile.name || 'Not set'}
- Age: ${profile.age || 'Not set'}
- Sex: ${profile.sex || 'Not set'}
- Activity Level: ${profile.activityLevel || 'Not set'}
- Weight: ${profile.weight ? profile.weight + ' lbs' : 'Not set'}
- Height: ${profile.height ? profile.height + ' inches' : 'Not set'}
- Dietary Restrictions: ${profile.dietaryRestrictions || 'None'}
- Health Conditions: ${profile.healthConditions || 'None'}

Daily Goals:
- Fiber: ${profile.fiberGoal || 30}g
- Water: ${profile.waterGoal || 64}oz
- Probiotics: ${profile.probioticGoal || 5} servings
- Calories: ${profile.calorieGoal || 2000}

Today's Intake:
- Fiber: ${fiber}g / ${profile.fiberGoal || 30}g
- Water: ${water}oz / ${profile.waterGoal || 64}oz
- Fermented Foods: ${fermented} / 3 servings
- Fruits + Veggies: ${veggies} / 5 servings
- Added Sugar: ${sugar}g / 25g limit
- Processed Foods: ${processed} / 3 servings limit
- Current Gut Score: ${gutScore}/100
- Meals logged: ${sampleMeals.length}

Recent meals: ${recentMeals}`;
}

// Add message to chat
function addMessage(content, isUser = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${isUser ? 'user-message' : 'bot-message'}`;
    
    messageDiv.innerHTML = `
        <div class="message-avatar">
            <span class="material-icons">${isUser ? 'person' : 'smart_toy'}</span>
        </div>
        <div class="message-content">
            <p>${content}</p>
        </div>
    `;
    
    chatMessages.appendChild(messageDiv);
    
    // Only auto-scroll if user is near the bottom (within 100px)
    const isNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 100;
    
    if (isNearBottom || isUser) {
        // Smooth scroll to bottom only if user was already near bottom or sent a message
        chatMessages.scrollTo({
            top: chatMessages.scrollHeight,
            behavior: 'smooth'
        });
    }
}

// Show typing indicator
function showTypingIndicator() {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'chat-message bot-message';
    typingDiv.id = 'typing-indicator';
    
    typingDiv.innerHTML = `
        <div class="message-avatar">
            <span class="material-icons">smart_toy</span>
        </div>
        <div class="message-content">
            <div class="typing-indicator">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        </div>
    `;
    
    chatMessages.appendChild(typingDiv);
    
    // Only auto-scroll if user is near the bottom
    const isNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 100;
    if (isNearBottom) {
        chatMessages.scrollTo({
            top: chatMessages.scrollHeight,
            behavior: 'smooth'
        });
    }
}

function removeTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();
}

// Send message to AI
/*async function sendMessageToAI(userMessage) {
    const user = window.auth.currentUser;
    if (!user) {
        addMessage("Please sign in to use the AI coach.", false);
        return;
    }

    addMessage(userMessage, true);
    showTypingIndicator();
    sendChatBtn.disabled = true;
    
    try {
        const context = await getUserContext();
        
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                messages: [
                    {
                        role: 'system',
                        content: `You are a gut health coach AI with full access to the user’s profile and nutrition data. Provide personalized, evidence-based advice aligned with current nutritional and microbiome science. All guidance must be accurate, actionable, and tailored to the user’s goals, restrictions, and health conditions. Reference their actual data, avoid speculation, and rely only on verified scientific consensus. Keep responses concise unless a detailed plan is requested.

Current User Data:
${context}`
                    },
                    {
                        role: 'user',
                        content: userMessage
                    }
                ],
                max_tokens: 500,
                temperature: 0.7
            })
        });
        
        const data = await response.json();
        const aiResponse = data.choices[0].message.content;
        
        removeTypingIndicator();
        addMessage(aiResponse, false);
        
    } catch (error) {
        console.error('Chat Error:', error);
        removeTypingIndicator();
        addMessage("I'm having trouble connecting right now. Please try again in a moment.", false);
    } finally {
        sendChatBtn.disabled = false;
    }
}*/

async function sendMessageToAI(userMessage) {
    const user = window.auth.currentUser;
    if (!user) {
        addMessage("Please sign in to use the AI coach.", false);
        return;
    }

    addMessage(userMessage, true);
    showTypingIndicator();
    sendChatBtn.disabled = true;

    try {
        const context = await getUserContext();

        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: userMessage,
                context: context
            })
        });

        const data = await response.json();

        removeTypingIndicator();
        addMessage(data.reply || "No response received.", false);

    } catch (error) {
        console.error("Chat error:", error);
        removeTypingIndicator();
        addMessage("Error connecting to AI service.", false);
    } finally {
        sendChatBtn.disabled = false;
    }
}

// Send button click
sendChatBtn.addEventListener('click', () => {
    const message = chatInput.value.trim();
    if (message) {
        sendMessageToAI(message);
        chatInput.value = '';
        chatInput.style.height = 'auto';
    }
});

// Enter key to send (Shift+Enter for new line)
chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatBtn.click();
    }
});

// Quick action buttons
quickActionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const prompt = btn.dataset.prompt;
        sendMessageToAI(prompt);
    });
});

window.toggleTopic = function(topicId) {
    const content = document.getElementById(`${topicId}-content`);
    if (!content) return;
    
    let card = content.parentElement;
    if (!card || !card.classList.contains('edu-topic-card')) return;
    
    const icon = card.querySelector('.expand-icon');
    if (!icon) return;
    
    const isVisible = content.style.display === 'block';
    content.style.display = isVisible ? 'none' : 'block';
    icon.textContent = isVisible ? 'expand_more' : 'expand_less';

    window.toggleTopic = function(topicId) {
    const content = document.getElementById(`${topicId}-content`);
    if (!content) return;
    
    let card = content.parentElement;
    if (!card || !card.classList.contains('edu-topic-card')) return;
    
    const icon = card.querySelector('.expand-icon');
    if (!icon) return;
    
    const isVisible = content.style.display === 'block';
    content.style.display = isVisible ? 'none' : 'block';
    icon.textContent = isVisible ? 'expand_more' : 'expand_less';
};



};
});