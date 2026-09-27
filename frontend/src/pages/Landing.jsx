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
const CROSSFADE_MS = 700;

/**
 * Ambient concept film: the clips play back to back on an endless loop, with the
 * next one fading in over the tail of the current one so the seam is not visible.
 * The files carry no audio track at all, so there is nothing to mute and no
 * controls are rendered — it is decorative, not a player.
 */
const PreviewFilm = () => {
  const videoRefs = useRef([]);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const switchingRef = useRef(false);

  const playClip = (index) => {
    const video = videoRefs.current[index];
    if (!video) return;
    video.muted = true;
    video.currentTime = 0;
    video.play?.()?.catch(() => {});
  };

  useEffect(() => {
    playClip(0);
  }, []);

  // Start the next clip while the current one is still on screen, then let the
  // CSS opacity transition carry the hand-off.
  const advanceFrom = (index) => {
    if (switchingRef.current || activeRef.current !== index) return;
    switchingRef.current = true;

    const next = (index + 1) % CLIPS.length;
    playClip(next);
    activeRef.current = next;
    setActive(next);

    window.setTimeout(() => {
      const finished = videoRefs.current[index];
      if (finished) {
        finished.pause();
        finished.currentTime = 0;
      }
      switchingRef.current = false;
    }, CROSSFADE_MS);
  };

  const handleTimeUpdate = (index) => {
    const video = videoRefs.current[index];
    if (!video || !Number.isFinite(video.duration)) return;
    if (video.duration - video.currentTime <= CROSSFADE_MS / 1000) advanceFrom(index);
  };

  return (
    <div className="relative overflow-hidden rounded-3xl border border-border bg-light-accent shadow-2xl shadow-light-accent/15">
      {/* Fixed ratio box so the section does not jump while the first clip loads. */}
      <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
        {CLIPS.map((src, index) => (
          <video
            key={src}
            ref={(el) => { videoRefs.current[index] = el; }}
            className="absolute inset-0 h-full w-full object-contain transition-opacity ease-linear"
            style={{ opacity: active === index ? 1 : 0, transitionDuration: `${CROSSFADE_MS}ms` }}
            src={src}
            poster={index === 0 ? '/edufusion-preview-poster.jpg' : undefined}
            muted
            playsInline
            preload="auto"
            disablePictureInPicture
            aria-hidden="true"
            tabIndex={-1}
            onTimeUpdate={() => handleTimeUpdate(index)}
            onEnded={() => advanceFrom(index)}
          />
        ))}
      </div>
    </div>
  );
};

export default function Landing() {
  const { isAuthenticated, user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const cta = isAuthenticated ? "/dashboard" : "/register";
  const toolLink = (route) =>
    isAuthenticated
      ? `/dashboard/${route === "my-prediction" && user?.role !== "student" ? "ai-tool" : route}`
      : "/login";
  return (
    <div className="landing-page">
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
              onClick={() => setMenuOpen(!menuOpen)}
              className="mobile-menu"
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
            >
              {menuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="mobile-nav" aria-label="Mobile navigation">
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
          <div className="hero-copy">
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
              <article key={t.name} className={`tool-card ${t.className}`}>
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
        <section id="preview" className="film-section section-space">
          <div className="site-container">
            <div className="section-heading">
              <div>
                <p className="eyebrow">TAKE A CLOSER LOOK</p>
                <h2>
                  See it all <em>come together.</em>
                </h2>
              </div>
              <p>
                A short concept film of EduFusion.
                <br />
                Explore the working tools in your dashboard.
              </p>
            </div>
            <PreviewFilm />
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
