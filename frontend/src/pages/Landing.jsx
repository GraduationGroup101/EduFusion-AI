import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  TrendingUp,
  Youtube,
  MessageSquare,
  FileQuestion,
  Menu,
  X,
  Check,
  ShieldCheck,
  GraduationCap,
  Users,
  LineChart,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import Brand, { BrandMark } from "../components/Brand";
import useLandingMotion from "../hooks/useLandingMotion";

const tools = [
  {
    name: "EduPredict",
    label: "A clearer path forward",
    icon: TrendingUp,
    className: "mint",
    description:
      "Understand academic risk early, follow your progress, and see where a little support could make a difference.",
    points: [
      "Personal academic risk indicators",
      "Course progress at a glance",
    ],
    route: "my-prediction",
  },
  {
    name: "LectureScribe",
    label: "Every lecture, within reach",
    icon: Youtube,
    className: "peach",
    description:
      "Turn recorded lectures into readable transcripts. Revisit the explanation you need, at your own pace.",
    points: [
      "Transcribe a YouTube lecture",
      "Read, copy and revisit your notes",
    ],
    route: "youtube",
  },
  {
    name: "Academic Chatbot",
    label: "Good questions. Clear answers.",
    icon: MessageSquare,
    className: "sage",
    description:
      "Ask about university life, programmes and student services in natural language, including Arabic.",
    points: ["Grounded in university knowledge", "Conversations in one place"],
    route: "chatbot",
  },
  {
    name: "Quiz Generator",
    label: "Turn your notes into know-how",
    icon: FileQuestion,
    className: "cream",
    description:
      "Upload your course material and create practice questions that help you prepare for what comes next.",
    points: [
      "Multiple choice, true/false and essay",
      "Generate and copy question sets",
    ],
    route: "question-gen",
  },
];
const nav = [
  ["#tools", "Your toolkit"],
  ["#how", "How it works"],
  ["#about", "Our story"],
];
const team = [
  "Abdullah Mohammed Shehdada",
  "Basem Hamdi Daqarem",
  "Nizar Yousef Alqerem",
];
const CLIPS = ['/edufusion-preview-1.mp4', '/edufusion-preview-2.mp4'];
/** Media is optional; the complete poster and product links work without it. */
const PreviewFilm = () => {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [active, setActive] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!window.IntersectionObserver) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) videoRef.current?.pause();
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);
  const togglePlayback = () => {
    if (!loaded) { setLoaded(true); return; }
    if (playing) videoRef.current?.pause();
    else videoRef.current?.play()?.catch(() => setFailed(true));
  };
  return (
    <div className="story-preview" ref={containerRef}>
      <div className="film-frame">
        {loaded && !failed ? <video key={active} ref={videoRef} src={CLIPS[active]} muted playsInline autoPlay controls preload="none"
          aria-label="EduFusion concept film" poster="/edufusion-preview-poster.jpg"
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onError={() => { setFailed(true); setPlaying(false); }}
          onEnded={() => { if (active < CLIPS.length - 1) setActive(active + 1); else setPlaying(false); }}
        /> : <img src="/edufusion-preview-poster.jpg" width="1920" height="1080" loading="lazy" alt="Concept preview of the EduFusion learning workspace" />}
      </div>
      <div className="film-caption">
        <span>{failed ? 'Film unavailable. Explore the tools above.' : 'Concept film · Explore the working tools above.'}</span>
        {!failed && <button type="button" onClick={togglePlayback}>{playing ? 'Pause film' : 'Play film'}<ArrowRight size={15} aria-hidden="true" /></button>}
      </div>
    </div>
  );
};

export default function Landing() {
  const { isAuthenticated, user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef(null);
  const menuButtonRef = useRef(null);
  useLandingMotion(rootRef);
  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = event => {
      if (event.key === 'Escape') { setMenuOpen(false); menuButtonRef.current?.focus(); }
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [menuOpen]);
  const cta = isAuthenticated ? "/dashboard" : "/register";
  const toolLink = (route) =>
    isAuthenticated
      ? `/dashboard/${route === "my-prediction" && user?.role !== "student" ? "ai-tool" : route}`
      : "/login";
  return (
    <div className="landing-page" ref={rootRef}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="landing-nav">
        <div className="site-container nav-inner">
          <Link to="/" aria-label="EduFusion home">
            <Brand />
          </Link>
          <nav aria-label="Main navigation" className="desktop-nav">
            {nav.map(([href, label]) => (
              <a href={href} key={href}>
                {label}
              </a>
            ))}
          </nav>
          <div className="nav-actions">
            <Link
              to={isAuthenticated ? "/dashboard" : "/login"}
              className="nav-signin"
            >
              {isAuthenticated ? "Dashboard" : "Sign in"}
            </Link>
            <Link to={cta} className="button-primary nav-cta">
              Get started <ArrowUpRight size={16} />
            </Link>
            <button
              ref={menuButtonRef}
              onClick={() => setMenuOpen(!menuOpen)}
              className="mobile-menu"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? 'landing-mobile-nav' : undefined}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
            >
              {menuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav id="landing-mobile-nav" className="mobile-nav" aria-label="Mobile navigation">
            {nav.map(([href, label]) => (
              <a href={href} key={href} onClick={() => setMenuOpen(false)}>
                {label}
              </a>
            ))}
          </nav>
        )}
      </header>
      <main id="main">
        <section className="site-container hero">
          <div className="hero-copy" data-reveal>
            <p className="eyebrow">
              <span className="brand-dot" /> A LITTLE MORE CONNECTED
            </p>
            <h1>
              All your learning.
              <br />A world of
              <br />
              <em>possibility.</em>
            </h1>
            <p className="hero-description">
              From the first question to your next breakthrough. Bring your
              lectures, practice, and academic progress together in one
              thoughtful space.
            </p>
            <div className="hero-actions">
              <Link to={cta} className="button-primary">
                {isAuthenticated
                  ? "Open your workspace"
                  : "Find your starting point"}
                <ArrowUpRight size={18} />
              </Link>
              <a href="#preview" className="text-link">
                Meet EduFusion <ArrowRight size={17} />
              </a>
            </div>
            <p className="hero-note">
              Four connected tools. One account. Your own pace.
            </p>
          </div>
          <div
            className="hero-art"
            aria-label="Four learning tools connected through EduFusion"
          >
            <div className="hero-art-heading">
              <span>THE CONNECTED LEARNING SPACE</span>
              <span>01 — 04</span>
            </div>
            <div className="art-orbit" />
            <div className="art-core">
              <BrandMark />
              <span>
                Built around
                <br />
                <strong>your learning.</strong>
              </span>
            </div>
            {tools.map((tool, i) => (
              <a
                href="#tools"
                className={`orbit-card orbit-card-${i} ${tool.className}`}
                key={tool.name}
              >
                <tool.icon size={21} />
                <span>{tool.name}</span>
                <ArrowUpRight size={14} />
              </a>
            ))}
            <div className="art-caption">
              <span className="brand-dot" /> A fresh perspective on education
            </div>
          </div>
        </section>
        <div className="platform-strip">
          <div className="site-container">
            <span>ONE SPACE. FOUR POSSIBILITIES.</span>
            {tools.map((t) => (
              <a key={t.name} href="#tools">
                <t.icon size={18} />
                {t.name}
              </a>
            ))}
          </div>
        </div>
        <section id="tools" className="site-container section-space">
          <div className="section-heading">
            <div>
              <p className="eyebrow">YOUR EVERYDAY TOOLKIT</p>
              <h2>
                Make room for
                <br />
                <em>the way you learn.</em>
              </h2>
            </div>
            <p>
              Less searching, more understanding.
              <br />A useful companion for every part of your learning journey.
            </p>
          </div>
          <div className="tool-grid">
            {tools.map((t, i) => (
              <article key={t.name} className={`tool-card ${t.className}`} data-reveal data-reveal-order={i % 2}>
                <div className="tool-top">
                  <span className="tool-icon">
                    <t.icon size={25} />
                  </span>
                  <span className="tool-number">
                    0{i + 1} / {t.name}
                  </span>
                  <ArrowUpRight size={21} />
                </div>
                <h3>{t.label}</h3>
                <p>{t.description}</p>
                <ul>
                  {t.points.map((p) => (
                    <li key={p}>
                      <Check size={15} />
                      {p}
                    </li>
                  ))}
                </ul>
                <Link to={toolLink(t.route)} className="tool-link">
                  Explore {t.name}
                  <ArrowRight size={17} />
                </Link>
              </article>
            ))}
          </div>
        </section>
        <section id="preview" className="film-section scroll-story" aria-labelledby="story-title">
          <div className="site-container story-stage">
            <div className="story-heading">
              <h2 id="story-title">See it all <em>come together.</em></h2>
              <p>From your next question to your next breakthrough. One connected learning space.</p>
            </div>
            <div className="story-tools" aria-label="Explore the connected tools">
              {tools.map((tool, index) => <Link key={tool.name} to={toolLink(tool.route)} className={`story-tool ${tool.className}`} style={{ '--tool-offset': `${(index - 1.5) * 16}px` }}>
                <tool.icon size={18} aria-hidden="true" /><span>{tool.name}</span><ArrowUpRight size={14} aria-hidden="true" />
              </Link>)}
            </div>
            <PreviewFilm />
            <p className="story-resolution">Four tools. <strong>All your learning, in one place.</strong></p>
          </div>
        </section>
        <section id="audience" className="site-container section-space">
          <p className="eyebrow">A SHARED PURPOSE</p>
          <h2>
            For the people
            <br />
            <em>behind the progress.</em>
          </h2>
          <div className="audience-grid">
            {[
              {
                icon: GraduationCap,
                title: "Students",
                text: "Find clarity in your courses. Study from transcripts, practise with your notes and understand your own progress.",
              },
              {
                icon: Users,
                title: "Instructors",
                text: "Give your material a second life. Turn lectures into readable notes and course documents into practice questions.",
              },
              {
                icon: LineChart,
                title: "Academic advisors",
                text: "See the signals sooner. Follow academic risk across courses and identify students who may need support.",
              },
            ].map((a, i) => (
              <article key={a.title}>
                <span className="audience-index">0{i + 1}</span>
                <a.icon size={28} />
                <h3>{a.title}</h3>
                <p>{a.text}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="how" className="site-container section-space">
          <div className="how-panel">
            <div>
              <p className="eyebrow">SMALL STEPS, NEW POSSIBILITIES</p>
              <h2>
                Your next chapter
                <br />
                starts <em>right here.</em>
              </h2>
              <Link to={cta} className="button-primary">
                Step inside
                <ArrowUpRight size={18} />
              </Link>
            </div>
            <ol>
              {[
                {
                  title: "Make yourself at home",
                  text: "Create a demo student profile, or sign in with your assigned account.",
                },
                {
                  title: "Choose what you need",
                  text: "A lecture to revisit, a question to answer, or progress to understand.",
                },
                {
                  title: "Take your next step",
                  text: "Use your results to revise, practise, and make informed decisions.",
                },
              ].map((step, i) => (
                <li key={step.title}>
                  <span>0{i + 1}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>
        <section
          id="about"
          className="site-container about-section section-space"
        >
          <div>
            <p className="eyebrow">BUILT WITH PURPOSE, IN GAZA</p>
            <h2>
              Better connected.
              <br />
              <em>Better together.</em>
            </h2>
            <p>
              EduFusion is a graduation project at the Islamic University of
              Gaza, bringing four education tools into one connected experience
              for students and educators.
            </p>
            <div className="privacy-note">
              <ShieldCheck size={20} />
              <span>
                Access follows your role. Your student records remain private to
                you.
              </span>
            </div>
          </div>
          <div className="team-panel">
            <p className="eyebrow">THE PEOPLE BEHIND EDUFUSION</p>
            {team.map((name, i) => (
              <div key={name}>
                <span>0{i + 1}</span>
                {name}
              </div>
            ))}
          </div>
        </section>
      </main>
      <footer className="site-container site-footer">
        <Link to="/" aria-label="EduFusion home">
          <Brand full />
        </Link>
        <p>All your learning, in one place.</p>
        <a href="#main">Back to top ↑</a>
      </footer>
    </div>
  );
}
