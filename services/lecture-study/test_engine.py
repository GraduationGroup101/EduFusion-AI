import os
os.environ["LECTURE_STUDY_EMBEDDINGS"] = "false"
import unittest
from engine import Engine, validate_citations


class EngineTests(unittest.TestCase):
    def test_chunking_preserves_the_end_of_long_lectures(self):
        text = "\n\n".join(("Paragraph %d: " % index) + "lecture content " * 150 for index in range(25))
        chunks = Engine().chunks(text + "\n\nFINAL_UNIQUE_SECTION")
        self.assertIn("FINAL_UNIQUE_SECTION", chunks[-1]["text"])
        self.assertGreater(len(chunks), 6)

    def test_summary_visits_every_section_and_citations_are_checked(self):
        visited = []
        def generator(_instruction, data, _schema):
            visited.extend(item["id"] for item in data["evidence"])
            return {"title": "Section", "summary": "Grounded summary", "concepts": ["Packets"],
                    "citations": [data["evidence"][-1]["id"]]}
        engine = Engine(generator)
        result = engine.prepare({"lecture": {"transcript": ("Networking " * 8000) + "THE_END"}})
        self.assertEqual(set(visited), {chunk["id"] for chunk in result["chunks"]})
        self.assertIn("THE_END", result["chunks"][-1]["text"])
        with self.assertRaises(ValueError):
            validate_citations(["other-lecture"], {"c0001"})

    def test_arabic_retrieval_and_source_only_unknown_answer(self):
        engine = Engine(lambda *_: {"answerable": True, "answer": "Unverified fact", "citations": []})
        chunks = [{"id": "c0001", "text": "الشبكات تستخدم حزم البيانات", "section": "s001"},
                  {"id": "c0002", "text": "مقدمة في الرياضيات", "section": "s002"}]
        self.assertEqual(engine.retrieve(chunks, "كيف تعمل حزم البيانات")[0]["id"], "c0001")
        result = engine.chat({"chunks": chunks, "payload": {"question": "ما الطقس اليوم؟"}, "history": []})
        self.assertIn("لا تحتوي", result["answer"])
        self.assertEqual(result["citations"], [])

    def test_invalid_and_foreign_citations_are_rejected(self):
        engine = Engine(lambda *_: {"answerable": True, "answer": "Stolen answer", "citations": ["another-account"]})
        with self.assertRaises(ValueError):
            engine.chat({"chunks": [{"id": "c0001", "text": "A lecture", "section": "s001"}],
                         "payload": {"question": "Question"}})

    def test_arabic_questions_do_not_publish_an_english_only_answer(self):
        engine = Engine(lambda *_: {"answerable": True, "answer": "English only", "citations": ["c0001"]})
        with self.assertRaises(ValueError):
            engine.chat({"chunks": [{"id": "c0001", "text": "الشبكات تستخدم الحزم", "section": "s001"}],
                         "payload": {"question": "كيف تعمل الشبكات؟"}})

    def test_quiz_questions_span_first_and_last_sections(self):
        visited = []
        def generator(_instruction, data, _schema):
            visited.extend(item["id"] for item in data["evidence"])
            questions = []
            for kind, count in data["counts"].items():
                for index in range(count):
                    questions.append({"type": kind, "prompt": data["evidence"][0]["id"] + kind + str(index),
                                      "choices": ["a", "b", "c", "d"] if kind == "mcq" else [],
                                      "answer": "a" if kind == "mcq" else True if kind == "tf" else "Model answer",
                                      "explanation": "Supported explanation", "concept": "Routing",
                                      "citations": [data["evidence"][0]["id"]],
                                      "rubric": ["Explain routing"] if kind == "essay" else []})
            return {"questions": questions}
        chunks = [{"id": "c%04d" % i, "text": "Content", "section": "s%03d" % i} for i in range(1, 7)]
        result = Engine(generator).quiz({"chunks": chunks, "payload": {"mcq": 4, "tf": 1, "essay": 1}})
        self.assertEqual(len(result["questions"]), 6)
        self.assertIn("c0001", visited)
        self.assertIn("c0006", visited)
        self.assertEqual(len(set(visited)), 6)

    def test_unrelated_evidence_does_not_reach_answer_generation(self):
        calls = []
        def generator(_instruction, data, _schema):
            calls.append(data)
            return {"answerable": False}
        result = Engine(generator).chat({"chunks": [{"id": "c0001", "text": "TCP delivers packets", "section": "s001"}],
                                        "payload": {"question": "What is today's weather?"}})
        self.assertEqual(len(calls), 1)
        self.assertEqual(result["citations"], [])
        self.assertIn("does not contain", result["answer"])

    def test_boolean_is_not_a_valid_mcq_index(self):
        question = {"type": "mcq", "prompt": "Question", "choices": ["a", "b", "c", "d"],
                    "answer": True, "explanation": "Reason", "concept": "Concept",
                    "citations": ["c0001"], "rubric": []}
        with self.assertRaises(ValueError):
            Engine.validate_question(question, {"c0001"})

    def test_quiz_rejects_a_drift_to_an_unsupported_language(self):
        def generator(_instruction, data, _schema):
            self.assertEqual(data["language"], "en")
            return {"questions": [{"type": "essay", "prompt": "解释网络协议", "choices": [],
                                   "answer": "TCP delivers reliably", "explanation": "Supported",
                                   "concept": "TCP", "citations": ["c0001"], "rubric": ["Reliability"]}]}
        with self.assertRaises(ValueError):
            Engine(generator).quiz({"chunks": [{"id": "c0001", "text": "TCP delivers reliably", "section": "s001"}],
                                    "payload": {"mcq": 0, "tf": 0, "essay": 1}})

    def test_preparation_resumes_completed_sections_after_worker_restart(self):
        checkpoints = []
        def generator(_instruction, data, _schema):
            if data["evidence"][0]["id"] == "c0002":
                raise RuntimeError("Simulated restart")
            return {"title": "First", "summary": "Persisted summary", "concepts": ["Packets"],
                    "citations": ["c0001"]}
        chunks = [{"id": "c0001", "text": "First", "section": "s001"},
                  {"id": "c0002", "text": "Last", "section": "s002"}]
        with self.assertRaises(RuntimeError):
            Engine(generator, progress=checkpoints.append).prepare({"chunks": chunks, "lecture": {}})
        calls = []
        def resumed(_instruction, data, _schema):
            calls.extend(item["id"] for item in data["evidence"])
            return {"title": "Last", "summary": "Last summary", "concepts": ["TCP"],
                    "citations": ["c0002"]}
        result = Engine(resumed).prepare({"chunks": chunks, "lecture": {"sections": checkpoints[-1]["sections"]}})
        self.assertEqual(calls, ["c0002"])
        self.assertIn("Persisted summary", result["summary"])
        self.assertIn("Last summary", result["summary"])

    def test_arabic_lectures_are_summarized_in_arabic(self):
        calls = []
        def generator(instruction, data, _schema):
            calls.append((instruction, data["language"]))
            return {"title": "الشبكات", "summary": "الموجه يختار المسار.", "concepts": ["التوجيه"],
                    "citations": [data["evidence"][0]["id"]]}
        # 'auto' lectures take the language of their text, even when it opens with an English term.
        chunks = [{"id": "c0001", "text": "TCP بروتوكول يضمن وصول الحزم بالترتيب الصحيح بين الأجهزة", "section": "s001"}]
        result = Engine(generator).prepare({"chunks": chunks, "lecture": {"language": "auto"}})
        self.assertEqual(calls[0][1], "ar")
        self.assertIn("in Arabic", calls[0][0])
        self.assertIn("الموجه", result["summary"])
        calls.clear()
        Engine(generator).prepare({"chunks": [{"id": "c0001", "text": "Routers forward packets", "section": "s001"}],
                                   "lecture": {"language": "ar"}})
        self.assertEqual(calls[0][1], "ar")

    def test_an_english_summary_of_an_arabic_lecture_is_retried_then_rejected(self):
        instructions = []
        def generator(instruction, _data, _schema):
            instructions.append(instruction)
            return {"title": "Networks", "summary": "Routers choose paths.", "concepts": [], "citations": ["c0001"]}
        chunks = [{"id": "c0001", "text": "الموجه يختار أفضل مسار بين الشبكات", "section": "s001"}]
        with self.assertRaises(ValueError):
            Engine(generator).prepare({"chunks": chunks, "lecture": {"language": "ar"}})
        self.assertEqual(len(instructions), 2)
        self.assertIn("ONLY in Arabic", instructions[1])
        replies = iter([{"title": "Networks", "summary": "Routers.", "concepts": [], "citations": ["c0001"]},
                        {"title": "الشبكات", "summary": "الموجهات.", "concepts": [], "citations": ["c0001"]}])
        result = Engine(lambda *_: next(replies)).prepare({"chunks": chunks, "lecture": {"language": "ar"}})
        self.assertEqual(result["sections"][0]["title"], "الشبكات")

    def test_english_lectures_keep_english_summaries(self):
        languages = []
        def generator(instruction, data, _schema):
            languages.append(data["language"])
            self.assertIn("in English", instruction)
            return {"title": "Routing", "summary": "Routers choose paths.", "concepts": ["Routing"], "citations": ["c0001"]}
        Engine(generator).prepare({"chunks": [{"id": "c0001", "text": "Routers forward packets between networks", "section": "s001"}],
                                   "lecture": {"language": "auto"}})
        self.assertEqual(languages, ["en"])

    def test_quiz_language_follows_the_main_script_of_an_auto_lecture(self):
        def generator(instruction, data, _schema):
            self.assertEqual(data["language"], "ar")
            self.assertIn("in Arabic", instruction)
            return {"questions": [{"type": "essay", "prompt": "اشرح البروتوكول", "choices": [], "answer": "يضمن الترتيب",
                                   "explanation": "مدعوم", "concept": "TCP", "citations": ["c0001"], "rubric": ["الترتيب"]}]}
        result = Engine(generator).quiz({"chunks": [{"id": "c0001", "text": "TCP بروتوكول يضمن وصول الحزم بالترتيب", "section": "s001"}],
                                         "lecture": {"language": "auto"}, "payload": {"mcq": 0, "tf": 0, "essay": 1}})
        self.assertEqual(len(result["questions"]), 1)

    def test_large_quiz_uses_bounded_batches_and_typed_answer_schemas(self):
        calls = []
        def generator(_instruction, data, output_schema):
            kind, count = next(iter(data["counts"].items()))
            calls.append((kind, count))
            self.assertLessEqual(count, 5)
            item_schema = output_schema["properties"]["questions"]["items"]
            self.assertEqual(item_schema["properties"]["answer"]["type"],
                             {"mcq": "string", "tf": "boolean", "essay": "string"}[kind])
            return {"questions": [{"type": kind, "prompt": str(len(calls)) + kind + str(i),
                "choices": ["a", "b", "c", "d"] if kind == "mcq" else [],
                "answer": "a" if kind == "mcq" else True if kind == "tf" else "Answer",
                "explanation": "Evidence", "concept": "Concept", "citations": ["c0001"],
                "rubric": ["Point"] if kind == "essay" else []} for i in range(count)]}
        result = Engine(generator).quiz({"chunks": [{"id": "c0001", "text": "Evidence", "section": "s001"}],
                                         "payload": {"mcq": 10, "tf": 10, "essay": 10}})
        self.assertEqual(len(result["questions"]), 30)
        self.assertEqual(len(calls), 6)
        self.assertTrue(all(item["answer"] == 0 for item in result["questions"] if item["type"] == "mcq"))


if __name__ == "__main__":
    unittest.main()
