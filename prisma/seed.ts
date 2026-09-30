/**
 * ScholarFolio — development seed.
 *
 * Produces one complete, internally consistent term for a small cohort of
 * students so every screen in the app has real data behind it: graded and
 * ungraded work, attendance at several risk levels, a partly-settled invoice
 * ledger, threads with unread messages, and notifications of every kind.
 *
 *   npm run db:seed
 *
 * Safe to re-run: everything is deleted and rewritten in one transaction.
 */
import {
  PrismaClient,
  Prisma,
  MeetingKind,
  AssessmentKind,
  SubmissionStatus,
  AttendanceStatus as AttendanceStatusEnum,
} from "@prisma/client";
// The seed must produce hashes that the login path can actually verify, so it
// imports the exact implementation rather than reimplementing it.
import { hashPassword } from "../src/lib/auth/password";
// Likewise for the student code: the seed should be unable to write a code the
// app would not accept, which is only true if it goes through the same builder.
import { formatStudentCode, INSTITUTION_CODE } from "../src/lib/student-code";
// The notification that quotes an invoice total formats it with the same helper
// the pages do, so the two cannot drift apart.
import { formatMoney } from "../src/lib/money";

const prisma = new PrismaClient();

/* -------------------------------------------------------------------------- */
/* Institution.                                                                */
/* -------------------------------------------------------------------------- */

/** Burdwan University. */
const INSTITUTION = INSTITUTION_CODE;

/** Bachelor of Computer Applications — the programme the cohort is enrolled in. */
const PROGRAMME = "BCA";
const PROGRAMME_NAME = "Bachelor of Computer Applications";

/** Everyone in the seed was admitted in the same intake, so they share a year. */
const ADMISSION_YEAR = 2024;

/* -------------------------------------------------------------------------- */
/* Calendar anchors. Fixed dates keep the seed reproducible.                    */
/* -------------------------------------------------------------------------- */

const TERM_CODE = "2026-FALL";
/** 2026-08-17 is a Monday. Week 7 therefore opens 2026-09-28. */
const TERM_START = new Date("2026-08-17T00:00:00.000Z");
const TERM_WEEKS = 16;
const TERM_END = new Date(TERM_START.getTime() + (TERM_WEEKS * 7 - 1) * 86_400_000);

/** "Today" for the seed, so relative deadlines read naturally. */
const NOW = new Date("2026-09-30T13:20:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

/** 0 = Monday, matching Prisma's `Meeting.dayOfWeek`. */
const MON = 0, TUE = 1, WED = 2, THU = 3, FRI = 4;
const t = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Deterministic password for every seeded account. */
const DEV_PASSWORD = "folio-demo-2026";

async function main() {
  // One hash for all accounts: seeding a dozen scrypt digests is slow and buys
  // nothing here, since these accounts all share one documented password.
  const passwordHash = await hashPassword(DEV_PASSWORD);
  console.log("[seed] clearing existing rows…");
  // Order matters only where FKs are RESTRICT; CASCADE handles the rest, but
  // an explicit list keeps the intent readable and the delete count small.
  await prisma.$transaction([
    prisma.auditEvent.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.invoiceLine.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.message.deleteMany(),
    prisma.threadParticipant.deleteMany(),
    prisma.thread.deleteMany(),
    prisma.announcement.deleteMany(),
    prisma.attendanceRecord.deleteMany(),
    prisma.attendanceSession.deleteMany(),
    prisma.submission.deleteMany(),
    prisma.assessment.deleteMany(),
    prisma.enrollment.deleteMany(),
    prisma.meetingException.deleteMany(),
    prisma.meeting.deleteMany(),
    prisma.section.deleteMany(),
    prisma.course.deleteMany(),
    prisma.term.deleteMany(),
    prisma.transcript.deleteMany(),
    prisma.session.deleteMany(),
    prisma.userPreference.deleteMany(),
    prisma.user.deleteMany(),
    prisma.program.deleteMany(),
  ]);

  /* ---------------------------------------------------------------- people -- */

  console.log("[seed] program, term, users…");

  const program = await prisma.program.create({
    data: {
      code: PROGRAMME,
      name: PROGRAMME_NAME,
      faculty: "Faculty of Science",
      years: 3,
    },
  });

  const term = await prisma.term.create({
    data: {
      code: TERM_CODE,
      name: "Fall 2026",
      startsOn: TERM_START,
      endsOn: TERM_END,
      weekCount: TERM_WEEKS,
      status: "IN_PROGRESS",
    },
  });

  /**
   * The cohort.
   *
   * The first entry is the account every other part of the seed hangs off, so it
   * carries the full academic record. The other two are the same intake and the
   * same programme with rolls either side of it, which is what makes the roll
   * number mean anything: `359` is only a roll because `303` and `307` exist.
   * They are enrolled in the same sections and carry no grades yet, which is the
   * ordinary state of a term seven weeks in — the first assessment of two of
   * their courses has not been marked.
   */
  const studentSpecs = [
    {
      email: "anirban.banerjee@college.edu",
      firstName: "Anirban",
      lastName: "Banerjee",
      roll: 359,
      avatarHue: 146,
      lastLoginAt: hours(-3),
      /** The account the academic record below belongs to. */
      primary: true,
    },
    {
      email: "nilay.bhattacharya@college.edu",
      firstName: "Nilay",
      lastName: "Bhattacharya",
      roll: 307,
      avatarHue: 24,
      lastLoginAt: hours(-29),
      primary: false,
    },
    {
      email: "rohit.sarkar@college.edu",
      firstName: "Rohit",
      lastName: "Sarkar",
      roll: 303,
      avatarHue: 96,
      lastLoginAt: hours(-52),
      primary: false,
    },
  ];

  const createdStudents = await Promise.all(
    studentSpecs.map((spec) =>
      prisma.user.create({
        data: {
          email: spec.email,
          passwordHash,
          role: "STUDENT",
          firstName: spec.firstName,
          lastName: spec.lastName,
          studentNumber: formatStudentCode({
            institution: INSTITUTION,
            programme: PROGRAMME,
            admissionYear: ADMISSION_YEAR,
            roll: spec.roll,
          }),
          studyYear: 2,
          programId: program.id,
          avatarHue: spec.avatarHue,
          lastLoginAt: spec.lastLoginAt,
        },
      }),
    ),
  );

  const student = createdStudents[0];

  const facultySpecs = [
    { email: "a.rao@college.edu", firstName: "Aditya", lastName: "Rao", title: "Dr.", avatarHue: 24 },
    { email: "s.iyer@college.edu", firstName: "Sudha", lastName: "Iyer", title: "Prof.", avatarHue: 96 },
    { email: "k.menon@college.edu", firstName: "Karthik", lastName: "Menon", title: "Dr.", avatarHue: 200 },
    { email: "l.das@college.edu", firstName: "Laxmi", lastName: "Das", title: "Dr.", avatarHue: 12 },
    { email: "r.sen@college.edu", firstName: "Rhea", lastName: "Sen", title: "Prof.", avatarHue: 320 },
    { email: "t.paul@college.edu", firstName: "Tara", lastName: "Paul", title: "Ms.", avatarHue: 264 },
  ];

  const faculty = await Promise.all(
    facultySpecs.map((f) =>
      prisma.user.create({
        data: {
          ...f,
          passwordHash,
          role: "FACULTY",
          isActive: true,
        },
      }),
    ),
  );
  const [rao, iyer, menon, das, sen, paul] = faculty;

  await prisma.userPreference.create({
    data: {
      userId: student.id,
      theme: "SYSTEM",
      density: "COMFORTABLE",
      weekStartsOn: 1,
      timezone: process.env.APP_TIMEZONE ?? "UTC",
    },
  });

  /* --------------------------------------------------------------- courses -- */

  console.log("[seed] courses, sections, meetings…");

  const courseSpecs = [
    {
      code: "CS-241", title: "Data Structures & Algorithms", credits: 4,
      department: "Computer Science", level: 200,
      description:
        "Abstract data types, complexity analysis, and the classic algorithm families: sorting, searching, graphs and dynamic programming. Assumes fluency with discrete mathematics.",
      instructor: rao, sectionNo: "01", room: "B-204", capacity: 90,
      meetings: [[MON, "10:00", "11:30", "LECTURE"], [THU, "10:00", "11:30", "LECTURE"]],
      progress: 74, letter: "A-", points: 3.7, earned: 4.0,
    },
    {
      code: "CS-243", title: "Database Systems", credits: 4,
      department: "Computer Science", level: 200,
      description:
        "Relational modelling, SQL, indexing, transaction processing and recovery. Includes a term project on a schema you design and defend.",
      instructor: iyer, sectionNo: "01", room: "A-102", capacity: 70,
      meetings: [[MON, "14:00", "15:30", "LECTURE"], [WED, "14:00", "15:30", "LECTURE"]],
      progress: 66, letter: "B+", points: 3.3, earned: 4.0,
    },
    {
      code: "MA-211", title: "Linear Algebra", credits: 3,
      department: "Mathematics", level: 200,
      description:
        "Vector spaces, linear maps, eigenvalues and the spectral theorem, with applications to graphics, optimisation and numerical methods.",
      instructor: menon, sectionNo: "01", room: "C-301", capacity: 120,
      meetings: [[TUE, "09:00", "10:15", "LECTURE"], [FRI, "09:00", "10:15", "TUTORIAL"]],
      progress: 83, letter: "A", points: 4.0, earned: 3.0,
    },
    {
      code: "CS-247", title: "Operating Systems", credits: 4,
      department: "Computer Science", level: 200,
      description:
        "Processes, threads, scheduling, virtual memory, file systems and concurrency, taught through a modified xv6 kernel.",
      instructor: das, sectionNo: "01", room: "B-110", capacity: 60,
      meetings: [[WED, "11:30", "13:00", "LECTURE"], [FRI, "11:30", "13:00", "LAB"]],
      progress: 55, letter: "B", points: 3.0, earned: 4.0,
    },
    {
      code: "HU-205", title: "Design & Society", credits: 2,
      department: "Humanities", level: 200,
      description:
        "How designed artefacts shape and are shaped by the people who use them. Studio format with field observation and a written reflection.",
      instructor: sen, sectionNo: "01", room: "D-014", capacity: 40,
      meetings: [[THU, "15:00", "17:00", "STUDIO"]],
      progress: 90, letter: "A", points: 4.0, earned: 2.0,
    },
    {
      code: "CS-251", title: "Web Engineering Lab", credits: 2,
      department: "Computer Science", level: 250,
      description:
        "A build-focused studio: semantic HTML, resilient CSS, typed client code, accessibility auditing and performance budgets.",
      instructor: paul, sectionNo: "01", room: "Lab 3", capacity: 36,
      meetings: [[MON, "15:30", "18:00", "LAB"]],
      progress: 79, letter: "A-", points: 3.7, earned: 2.0,
    },
  ];

  const sections = [];
  for (const spec of courseSpecs) {
    const course = await prisma.course.create({
      data: {
        code: spec.code,
        title: spec.title,
        description: spec.description,
        credits: spec.credits,
        level: spec.level,
        department: spec.department,
        programId: program.id,
      },
    });
    const section = await prisma.section.create({
      data: {
        courseId: course.id,
        termId: term.id,
        sectionNo: spec.sectionNo,
        room: spec.room,
        capacity: spec.capacity,
        instructorId: spec.instructor.id,
        status: "OPEN",
      },
    });
    const meetingRows = spec.meetings.map(([day, start, end, kind]) => ({
      sectionId: section.id,
      dayOfWeek: day as number,
      startMin: t(start as string),
      endMin: t(end as string),
      kind: kind as MeetingKind,
      room: spec.room,
    }));
    await prisma.meeting.createMany({ data: meetingRows });

    // The whole cohort takes the same courses, which is what a shared section
    // means. Only the primary student's rows carry grades; the other two are
    // enrolled and present in class lists, with nothing submitted yet.
    const enrollment = await prisma.enrollment.create({
      data: {
        studentId: student.id,
        sectionId: section.id,
        termId: term.id,
        status: "ENROLLED",
      },
    });

    await prisma.enrollment.createMany({
      data: createdStudents.slice(1).map((peer) => ({
        studentId: peer.id,
        sectionId: section.id,
        termId: term.id,
        status: "ENROLLED" as const,
      })),
    });

    sections.push({ ...spec, course, section, enrollment });
  }

  /* ------------------------------------------------------------ one clash -- */

  // A relocated meeting so the disruption view is not theoretical.
  const osSection = sections[3];
  const wedMeeting = await prisma.meeting.findFirstOrThrow({
    where: { sectionId: osSection.section.id, dayOfWeek: WED },
  });
  await prisma.meetingException.create({
    data: {
      meetingId: wedMeeting.id,
      sectionId: osSection.section.id,
      date: days(9),
      kind: "RELOCATED",
      note: "B-110 is hosting the departmental review — meet in C-204 instead.",
      room: "C-204",
    },
  });
  const thuMeeting = await prisma.meeting.findFirstOrThrow({
    where: { sectionId: osSection.section.id, dayOfWeek: FRI },
  });
  await prisma.meetingException.create({
    data: {
      meetingId: thuMeeting.id,
      sectionId: osSection.section.id,
      date: days(16),
      kind: "CANCELLED",
      note: "Institute holiday — no lab.",
    },
  });

  /* ----------------------------------------------------------- assessments -- */

  console.log("[seed] assessments and submissions…");

  const assessmentSpecs = [
    { sec: 0, title: "AVL rotations & amortised analysis", kind: "ASSIGNMENT", weight: 12, due: days(2), pos: 1, status: "NOT_STARTED" },
    { sec: 1, title: "Normalisation to BCNF — clinic schema", kind: "ASSIGNMENT", weight: 10, due: days(3), pos: 1, status: "NOT_STARTED" },
    { sec: 2, title: "Eigenvalue problem sheet 6", kind: "ASSIGNMENT", weight: 8, due: days(5), pos: 1, status: "DRAFT" },
    { sec: 3, title: "xv6 system-call tracer", kind: "LAB_REPORT", weight: 15, due: days(7), pos: 1, status: "NOT_STARTED" },
    { sec: 5, title: "Capstone milestone 2 — scheduler view", kind: "PROJECT", weight: 20, due: days(9), pos: 1, status: "NOT_STARTED" },
    { sec: 4, title: "Field notes: campus wayfinding critique", kind: "ASSIGNMENT", weight: 10, due: days(11), pos: 1, status: "NOT_STARTED" },
    { sec: 3, title: "Concurrency quiz", kind: "QUIZ", weight: 8, due: days(13), pos: 2, status: "NOT_STARTED" },
    { sec: 0, title: "Heap & Huffman coding lab", kind: "LAB_REPORT", weight: 10, due: days(-6), pos: 2, status: "GRADED", score: 92, feedback: "Correct and well-explained. The trace for the degenerate case is the strongest part of the submission." },
    { sec: 1, title: "SQL joins drill", kind: "QUIZ", weight: 8, due: days(-10), pos: 2, status: "GRADED", score: 88, feedback: "One lost mark on the anti-join. Re-read the null-handling section." },
    { sec: 2, title: "Mid-semester examination", kind: "EXAM", weight: 25, due: days(-15), pos: 2, status: "GRADED", score: 91, feedback: "Eigenbasis reasoning is excellent. More geometric intuition, fewer coordinate computations." },
    { sec: 3, title: "Process scheduling simulation", kind: "LAB_REPORT", weight: 12, due: days(-18), pos: 2, status: "GRADED", score: 76, feedback: "Correct results, thin write-up. Document your assumptions before the charts." },
    { sec: 5, title: "Accessibility audit report", kind: "PROJECT", weight: 10, due: days(-22), pos: 2, status: "GRADED", score: 95, feedback: "Best audit in the section. The remediation table is exactly the right level of detail." },
    { sec: 4, title: "Manifesto draft", kind: "ASSIGNMENT", weight: 6, due: days(-25), pos: 2, status: "LATE", score: 74, feedback: "Submitted four days late. The argument is strong; the deadline is part of the brief." },
  ];

  const assessmentIds: { id: string; due: Date | null }[] = [];

  for (const spec of assessmentSpecs) {
    const s = sections[spec.sec];
    const released = new Date((spec.due as Date).getTime() - 14 * 86_400_000);
    const assessment = await prisma.assessment.create({
      data: {
        sectionId: s.section.id,
        title: spec.title,
        kind: spec.kind as AssessmentKind,
        weightPercent: new Prisma.Decimal(spec.weight),
        maxScore: new Prisma.Decimal(100),
        dueAt: spec.due,
        releasedAt: released,
        position: spec.pos,
        brief:
          spec.kind === "PROJECT" || spec.kind === "LAB_REPORT"
            ? "Submit a working artefact plus a short written reflection. Rubric: correctness 55 · clarity 25 · tests 20. Late work loses 10% per day, capped at 50%."
            : "Answer all parts. Show working for every result — an unexplained answer earns no credit. Late work loses 10% per day, capped at 50%.",
      },
    });
    assessmentIds.push({ id: assessment.id, due: spec.due });

    if (spec.status === "NOT_STARTED") continue;

    await prisma.submission.create({
      data: {
        assessmentId: assessment.id,
        studentId: student.id,
        status: spec.status as SubmissionStatus,
        draftBody:
          spec.status === "DRAFT"
            ? "Part 1 done. Part 2 needs the basis-vector argument reworked before I can finish it."
            : null,
        submittedAt: new Date((spec.due as Date).getTime() + (spec.status === "LATE" ? 4 * 86_400_000 : -hours(9))),
        score: spec.score !== undefined ? new Prisma.Decimal(spec.score) : null,
        feedback: spec.feedback ?? null,
        gradedAt: spec.status === "GRADED" ? days(-4) : null,
        attempt: 1,
      },
    });
  }

  /* ------------------------------------------------------------- attendance -- */

  console.log("[seed] attendance…");

  // Seven weeks of classes, so the heat strip has real history to show.
  const sessionDates: Date[] = [];
  for (let w = 0; w < 7; w++) {
    for (let d = 0; d < 5; d++) {
      sessionDates.push(new Date(TERM_START.getTime() + (w * 7 + d) * 86_400_000));
    }
  }

  // Per-section outcome profile. `present` is the implied remainder — the array
  // starts all-PRESENT and misses are stamped on top — so only the miss counts
  // below matter. CS-247 (Operating Systems) is deliberately the problem course,
  // tuned to sit just above the 75% exam-eligibility floor so the attendance
  // screen has a genuine risk state to render rather than a hypothetical one.
  const missProfile = [
    { absent: 1, late: 1, excused: 0 }, // CS-241
    { absent: 1, late: 1, excused: 1 }, // CS-243
    { absent: 1, late: 0, excused: 0 }, // MA-211
    { absent: 3, late: 0, excused: 1 }, // CS-247 — one more absence breaches
    { absent: 0, late: 0, excused: 0 }, // HU-205 — spotless
    { absent: 0, late: 1, excused: 0 }, // CS-251
  ];

  const heat: { date: string; PRESENT: number; LATE: number; ABSENT: number; EXCUSED: number }[] = [];
  const tally = sections.map(() => ({ present: 0, late: 0, absent: 0, excused: 0, total: 0 }));

  for (let si = 0; si < sections.length; si++) {
    const section = sections[si];
    const meetings = await prisma.meeting.findMany({
      where: { sectionId: section.section.id },
      orderBy: { startMin: "asc" },
    });
    const meetingDays = new Set(meetings.map((m) => m.dayOfWeek));

    // Dates on which this section actually met.
    const dates = sessionDates.filter((d) => meetingDays.has(d.getUTCDay() - 1));

    // One status per session, spread out rather than clustered: misses land on
    // an even stride so the heat strip reads like a real term.
    const profile = missProfile[si];
    const statusFor: AttendanceStatus[] = new Array(dates.length).fill("PRESENT");
    const place = (status: AttendanceStatus, count: number, offset: number) => {
      for (let i = 0; i < count; i++) {
        const index = Math.min(dates.length - 1, offset + i * Math.max(1, Math.floor(dates.length / (count + 1))));
        statusFor[index] = status;
      }
    };
    place("ABSENT", profile.absent, 1);
    place("LATE", profile.late, 2);
    place("EXCUSED", profile.excused, 3);

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const first = meetings.find((m) => m.dayOfWeek === date.getUTCDay() - 1)!;

      const session = await prisma.attendanceSession.create({
        data: {
          sectionId: section.section.id,
          date,
          topic: null,
          openedAt: new Date(date.getTime() + (first.startMin - 10) * 60_000),
          closedAt: new Date(date.getTime() + (first.endMin + 10) * 60_000),
        },
      });

      const status = statusFor[i];
      await prisma.attendanceRecord.create({
        data: {
          sessionId: session.id,
          studentId: student.id,
          status,
          note: status === "EXCUSED" ? "Medical certificate on file." : null,
        },
      });

      const entry = tally[si];
      if (status === "PRESENT") entry.present++;
      else if (status === "LATE") entry.late++;
      else if (status === "ABSENT") entry.absent++;
      else entry.excused++;
      entry.total++;

      const iso = date.toISOString().slice(0, 10);
      let bucket = heat.find((h) => h.date === iso);
      if (!bucket) {
        bucket = { date: iso, PRESENT: 0, LATE: 0, ABSENT: 0, EXCUSED: 0 };
        heat.push(bucket);
      }
      if (status === "ABSENT") bucket.ABSENT++;
      else if (status === "LATE") bucket.LATE++;
      else if (status === "EXCUSED") bucket.EXCUSED++;
      else bucket.PRESENT++;
    }
  }


  /* ---------------------------------------------------------------- finance -- */

  console.log("[seed] invoices and payments…");

  /**
   * Amounts are paise — 100 to the rupee — so ₹15,500 is `1_550_000`.
   *
   * These are plausible figures for a BCA student at a West Bengal state
   * university, not converted dollar amounts: a laboratory fee is a few thousand
   * rupees and a tuition instalment a few tens of thousands. Relabelling the old
   * USD figures as rupees would have produced a ₹680 laboratory fee, which reads
   * as a broken feed rather than a fee.
   */
  const paidInvoice = await prisma.invoice.create({
    data: {
      number: "INV-2026-0138",
      studentId: student.id,
      termId: term.id,
      status: "PAID",
      issuedOn: days(-61),
      dueOn: days(-46),
      currency: "INR",
      totalCents: 1_550_000,
      subtotalCents: 1_550_000,
      notes: "Laboratory and library services, Autumn 2026.",
      lines: {
        create: [
          { description: "Laboratory fee — CS-241, CS-243, CS-247, CS-251", category: "LAB_FEE", quantity: 1, unitPriceCents: 1_200_000, amountCents: 1_200_000, position: 0 },
          { description: "Library services & print allowance", category: "LIBRARY_FINE", quantity: 1, unitPriceCents: 350_000, amountCents: 350_000, position: 1 },
        ],
      },
    },
    include: { lines: true },
  });

  await prisma.payment.create({
    data: {
      receiptNo: "RCPT-41022",
      invoiceId: paidInvoice.id,
      studentId: student.id,
      amountCents: paidInvoice.totalCents,
      currency: "INR",
      method: "UPI",
      reference: "anirbanb@upi",
      paidAt: days(-63),
      idempotencyKey: "seed-pay-0138",
    },
  });

  const residenceInvoice = await prisma.invoice.create({
    data: {
      number: "INV-2026-0142",
      studentId: student.id,
      termId: term.id,
      status: "ISSUED",
      issuedOn: days(-30),
      dueOn: days(0),
      currency: "INR",
      totalCents: 1_340_000,
      subtotalCents: 1_340_000,
      notes: "Residence and dining, weeks 5–8.",
      lines: {
        create: [
          { description: "Residence — North Block, single study room", category: "HOUSING", quantity: 1, unitPriceCents: 950_000, amountCents: 950_000, position: 0 },
          { description: "Dining plan — 4 weeks", category: "OTHER", quantity: 1, unitPriceCents: 390_000, amountCents: 390_000, position: 1 },
        ],
      },
    },
  });

  await prisma.invoice.create({
    data: {
      number: "INV-2026-0146",
      studentId: student.id,
      termId: term.id,
      status: "ISSUED",
      issuedOn: days(-12),
      dueOn: days(15),
      currency: "INR",
      totalCents: 2_850_000,
      subtotalCents: 2_850_000,
      notes: "Tuition instalment 2 of 3. Late payment carries a 2% administrative fee.",
      lines: {
        create: [
          { description: "Tuition instalment 2 — BCA, year 2", category: "TUITION", quantity: 1, unitPriceCents: 2_400_000, amountCents: 2_400_000, position: 0 },
          { description: "Course materials allowance", category: "MATERIALS", quantity: 1, unitPriceCents: 450_000, amountCents: 450_000, position: 1 },
        ],
      },
    },
  });

  /* --------------------------------------------------------------- messages -- */

  console.log("[seed] announcements, threads, notifications…");

  await prisma.announcement.createMany({
    data: [
      {
        title: "Mid-semester feedback is live",
        body: "Rubric comments for CS-241 and CS-247 are published. Grades are provisional until the resubmission window closes on 6 October.",
        authorId: rao.id, audience: "ALL_STUDENTS", termId: term.id, pinned: true, publishedAt: hours(-5),
      },
      {
        title: "Operating Systems lab relocated",
        body: "Next Wednesday's lab meets in C-204. The B-110 room is hosting an external review panel.",
        authorId: das.id, audience: "COURSE", sectionId: osSection.section.id, termId: term.id, publishedAt: days(1),
      },
      {
        title: "Library extends opening hours to 23:00",
        body: "Extended hours run from 28 September to the end of the assessment period. Reserve desks close at 20:00 as usual.",
        authorId: iyer.id, audience: "ALL_STUDENTS", termId: term.id, publishedAt: days(3),
      },
      {
        title: "Fee deadline reminder",
        body: "Pay before 15 October to have the receipt attached to your identity card before the next verification.",
        authorId: iyer.id, audience: "ALL_STUDENTS", termId: term.id, publishedAt: days(5),
      },
    ],
  });

  const threadSpecs = [
    {
      subject: "AVL deletion traces",
      courseCode: "CS-241", with: rao, unread: true, hoursAgo: 3,
      messages: [
        { from: student.id, body: "Dr. Rao — for Thursday, should I include the double-rotation case in the deletion trace, or is the single rotation enough?", hoursAgo: 31 },
        { from: rao.id, body: "Include it. Deletion is where AVL implementations usually break, and the double rotation is the part that matters. Bring your trace to office hours on Wednesday at 16:00 and we will work through the edge cases together.", hoursAgo: 3 },
      ],
    },
    {
      subject: "Capstone scope — scheduler view",
      courseCode: "CS-251", with: paul, unread: true, hoursAgo: 27,
      messages: [
        { from: paul.id, body: "Milestone 2 is due a week before the reading week. Keep the scope to one interactive view plus its empty, loading and error states — depth beats breadth here.", hoursAgo: 30 },
        { from: student.id, body: "Understood. I have the schedule grid working with keyboard navigation. I still need the optimistic-update and failure paths.", hoursAgo: 27 },
        { from: paul.id, body: "Good. The failure path is what the rubric is actually testing. Ship the failure state first if you have to choose.", hoursAgo: 27 },
      ],
    },
    {
      subject: "Database project schema review",
      courseCode: "CS-243", with: iyer, unread: false, hoursAgo: 74,
      messages: [
        { from: iyer.id, body: "Your clinic schema is in good shape. One note: model the appointment slot as its own entity rather than a column — you will need it for the conflict query.", hoursAgo: 80 },
        { from: student.id, body: "That is much cleaner. I will restructure before the BCNF worksheet is due.", hoursAgo: 74 },
      ],
    },
    {
      subject: "Library reserve ready",
      courseCode: null, with: sen, unread: false, hoursAgo: 100,
      messages: [
        { from: sen.id, body: "The design ethnography reading you asked for is on hold at counter 4 until Friday evening.", hoursAgo: 100 },
      ],
    },
  ];

  for (const spec of threadSpecs) {
    const course = spec.courseCode ? sections.find((s) => s.course.code === spec.courseCode)?.course : null;
    const thread = await prisma.thread.create({
      data: { subject: spec.subject, courseId: course?.id ?? null, updatedAt: hours(-spec.hoursAgo) },
    });
    await prisma.threadParticipant.createMany({
      data: [
        { threadId: thread.id, userId: student.id, lastReadAt: spec.unread ? null : hours(-spec.hoursAgo) },
        { threadId: thread.id, userId: spec.with.id, lastReadAt: hours(-spec.hoursAgo) },
      ],
    });
    for (const m of spec.messages) {
      await prisma.message.create({
        data: { threadId: thread.id, senderId: m.from, body: m.body, createdAt: hours(-m.hoursAgo) },
      });
    }
  }

  // Derive the attendance-risk notification from what was actually written above,
  // rather than hard-coding a number. A notification that contradicts the
  // attendance screen is worse than no notification.
  const sectionRates = sections
    .map((section, index) => {
      const entry = tally[index];
      const denominator = entry.present + entry.late + entry.absent;
      return {
        code: section.course.code,
        rate: denominator === 0 ? 100 : ((entry.present + entry.late * 0.5) / denominator) * 100,
        counted: denominator,
      };
    })
    .sort((a, b) => a.rate - b.rate);
  const weakest = sectionRates[0];

  await prisma.notification.createMany({
    data: [
      { userId: student.id, kind: "GRADE_POSTED", title: "Mid-sem feedback published", body: "CS-241 and CS-247 rubric comments are ready.", href: "/grades", readAt: null, createdAt: hours(-5) },
      { userId: student.id, kind: "ASSIGNMENT_DUE", title: "xv6 system-call tracer due in 7 days", body: "Carries 15% of your CS-247 grade.", href: "/assignments", readAt: null, createdAt: hours(-20) },
      { userId: student.id, kind: "MESSAGE_RECEIVED", title: "Dr. A. Rao replied", body: "AVL deletion traces", href: "/messages", readAt: null, createdAt: hours(-3) },
      // The amount is read off the invoice and formatted by the same helper the
      // UI uses, rather than typed in. A hardcoded figure here survives every
      // change to the invoice and disagrees with it in exactly one place — a
      // notification quoting a total that no longer exists on any page it links
      // to — which is both wrong and very hard to notice.
      {
        userId: student.id,
        kind: "PAYMENT_DUE",
        title: `${residenceInvoice.number} due today`,
        body: `${formatMoney(residenceInvoice.totalCents, residenceInvoice.currency)} for residence and dining.`,
        href: "/finance",
        readAt: null,
        createdAt: hours(-9),
      },
      {
        userId: student.id,
        kind: "ATTENDANCE_RISK",
        title: `${weakest.code} attendance at ${weakest.rate.toFixed(0)}%`,
        body: "One more absence puts the exam eligibility at risk.",
        href: "/attendance",
        readAt: hours(-2),
        createdAt: days(-1),
      },
      { userId: student.id, kind: "ANNOUNCEMENT", title: "Library extends opening hours to 23:00", body: "From 28 September to the end of the assessment period.", href: "/today", readAt: days(-3), createdAt: days(-3) },
    ],
  });

  /* ------------------------------------------------------------- transcript -- */

  const currentPoints = sections.reduce((sum, s) => sum + s.points * s.credits, 0);
  const currentCredits = sections.reduce((sum, s) => sum + s.credits, 0);

  // Prior terms, hard-coded so the cumulative GPA has a believable history.
  const priorPoints = 3.62 * 46;
  const attempted = 46 + currentCredits;
  const earned = 46 + sections.reduce((sum, s) => sum + s.earned, 0);

  await prisma.transcript.create({
    data: {
      studentId: student.id,
      cumulativeGpa: new Prisma.Decimal(
        (((priorPoints + currentPoints) / attempted) as number).toFixed(3),
      ),
      creditsAttempted: new Prisma.Decimal(attempted),
      creditsEarned: new Prisma.Decimal(earned),
      standing: "Good standing — Dean’s list candidate",
      generatedAt: hours(-4),
    },
  });

  await prisma.auditEvent.createMany({
    data: [
      { actorId: student.id, action: "auth.login", outcome: "SUCCESS", resource: "session", resourceId: "seed", ipAddress: "127.0.0.1", createdAt: hours(-3) },
      { actorId: student.id, action: "payment.created", outcome: "SUCCESS", resource: "invoice", resourceId: paidInvoice.id, metadata: { receipt: "RCPT-41022" }, createdAt: days(-63) },
    ],
  });

  /* --------------------------------------------------------------- summary -- */

  const assessed = tally.reduce(
    (acc, entry) => {
      acc.present += entry.present;
      acc.late += entry.late;
      acc.absent += entry.absent;
      acc.excused += entry.excused;
      acc.total += entry.total;
      return acc;
    },
    { present: 0, late: 0, absent: 0, excused: 0, total: 0 },
  );
  const overall = Math.round(
    ((assessed.present + assessed.late * 0.5) / assessed.total) * 100,
  );
  const flaggedDays = heat.filter((d) => d.ABSENT > 0 || d.LATE > 0).length;

  console.log("[seed] done.");
  console.log(`[seed]   student      ${student.email}`);
  console.log(`[seed]   password     ${DEV_PASSWORD}   (every seeded account)`);
  console.log(`[seed]   term         ${term.name} · 16 weeks from 17 Aug 2026`);
  console.log(`[seed]   attendance   ${overall}% across ${assessed.total} classes · ${flaggedDays} flagged days`);
  console.log(
    `[seed]   open work    ${assessmentSpecs.filter((a) => a.status === "NOT_STARTED" || a.status === "DRAFT").length} assessments outstanding`,
  );
  console.log(`[seed]   outstanding  2 invoices, 1 receipt`);
}

type AttendanceStatus = AttendanceStatusEnum;

main()
  .catch((error) => {
    console.error("[seed] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
