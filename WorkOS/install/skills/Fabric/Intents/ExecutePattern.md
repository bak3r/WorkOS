# ExecutePattern

**Contents:** Ideal State · Anti-criteria · Inputs · Tool contract · Output format · References

Runs a Fabric pattern natively from local storage: the model reads the pattern's system.md and applies it to the content, with the fabric CLI used only for YouTube transcripts and blocked URLs.

## Ideal State

- The pattern applied is the one the request named explicitly, or otherwise the one the selection table and its keyword rule map the request's wording to.
- When that pattern is in § Ported patterns, its intent runs instead and the upstream system.md is never used as the prompt; this intent applies only to patterns with no port.
- Except for YouTube (`fabric -y`) and blocked-URL (`fabric -u`) runs, the output is the local `Patterns/<name>/system.md` applied by the model directly to the provided content, following its STEPS and OUTPUT INSTRUCTIONS; the fabric CLI ran only in those two cases: a YouTube URL, or a URL whose native fetch failed.
- The returned output preserves the format the pattern's OUTPUT INSTRUCTIONS specify.
- A missing pattern or missing content is answered with the matching Error Handling message.

## Anti-criteria

- A ported pattern never runs from its upstream system.md: its intent and checker are the contract.
- A site that refuses automated access is never retried through another path.

## Inputs

Pattern selection from the request's wording:

| User Intent Contains | Pattern |
|---------------------|---------|
| "extract wisdom", "wisdom" | `extract_wisdom` |
| "summarize", "summary" | the Summarize intent (port of `summarize`) |
| "5 sentence", "short summary" | the WordSummary intent (our port of `create_5_sentence_summary`; the upstream prompt never runs) |
| "micro summary", "tldr" | `create_micro_summary` |
| "threat model" | `create_threat_model` |
| "stride", "stride model" | `create_stride_threat_model` |
| "analyze claims", "fact check" | the AnalyzeClaims intent (port of `analyze_claims`) |
| "analyze code", "code review" | `review_code` |
| "main idea", "core message" | `extract_main_idea` |
| "improve writing", "enhance" | `improve_writing` |
| "improve prompt" | `improve_prompt` |
| "extract insights" | the ExtractInsights intent (port of `extract_insights`) |
| "analyze malware" | the AnalyzeMalware intent (port of `analyze_malware`) |
| "create prd" | `create_prd` |
| "mermaid", "diagram" | `create_mermaid_visualization` |
| "rate", "evaluate" | `rate_content` or `judge_output` |

**If pattern is explicitly named:** Use that pattern directly (e.g., "use extract_article_wisdom" -> `extract_article_wisdom`), unless § Ported patterns lists it.

Requests the table does not list map by keyword: `analyze <x>` → `analyze_<x>` (for example "paper" → `analyze_paper`), `create <x>` → `create_<x>`, and a bare "improve" → `improve_writing`, when that pattern exists under `Patterns/`.

### Ported patterns

Every pattern below runs as its intent in `skills/Fabric/Intents/<Intent>.md`, whether it was named or reached through the table or the keyword rule. The intent owns the output format and its own Assay suite. The upstream system.md stays in `Patterns/` for reference only.

<!-- ported-patterns:start -->
| Pattern | Runs |
|---------|------|
| `create_5_sentence_summary` | WordSummary |
| `analyze_threat_report` | AnalyzeThreatReport |
| `analyze_threat_report_cmds` | AnalyzeThreatReport |
| `analyze_threat_report_trends` | AnalyzeThreatReport |
| `create_threat_scenarios` | ThreatScenarios |
| `create_report_finding` | ReportFinding |
| `improve_report_finding` | ReportFinding |
| `analyze_logs` | AnalyzeLogs |
| `analyze_malware` | AnalyzeMalware |
| `analyze_incident` | AnalyzeIncident |
| `create_cyber_summary` | CyberSummary |
| `write_semgrep_rule` | SemgrepRule |
| `ask_secure_by_design_questions` | SecureByDesignQuestions |
| `create_sigma_rules` | SigmaRules |
| `analyze_email_headers` | EmailHeaders |
| `write_nuclei_template_rule` | NucleiTemplate |
| `create_network_threat_landscape` | NetworkThreatLandscape |
| `extract_poc` | ExtractPoc |
| `analyze_terraform_plan` | TerraformPlan |
| `analyze_claims` | AnalyzeClaims |
| `find_logical_fallacies` | LogicalFallacies |
| `check_falsifiability` | CheckFalsifiability |
| `extract_ethical_framework` | EthicalFramework |
| `check_agreement` | CheckAgreement |
| `audit_transparency` | AuditTransparency |
| `audit_consent` | AuditConsent |
| `detect_mind_virus` | MindVirus |
| `analyze_bill` | AnalyzeBill |
| `compare_and_contrast` | CompareAndContrast |
| `analyze_risk` | AnalyzeRisk |
| `lens_rhetorical` | RhetoricalLens |
| `lens_stoic` | StoicLens |
| `extract_predictions` | ExtractPredictions |
| `analyze_paper` | AnalyzePaper |
| `summarize_paper` | AnalyzePaper |
| `analyze_paper_simple` | AnalyzePaper |
| `extract_insights` | ExtractInsights |
| `extract_patterns` | ExtractPatterns |
| `summarize` | Summarize |
| `extract_ideas` | ExtractIdeas |
| `apply_ul_tags` | UlTags |
| `summarize_meeting` | SummarizeMeeting |
| `extract_business_ideas` | BusinessIdeas |
| `extract_recommendations` | ExtractRecommendations |
| `summarize_debate` | SummarizeDebate |
| `analyze_comments` | AnalyzeComments |
| `create_design_document` | DesignDocument |
| `explain_code` | ExplainCode |
| `review_design` | ReviewDesign |
| `write_pull-request` | PullRequest |
| `explain_docs` | ExplainDocs |
| `explain_terms` | ExplainTerms |
| `generate_code_rules` | CodeRules |
| `analyze_prose` | AnalyzeProse |
| `analyze_prose_pinker` | AnalyzeProse |
| `create_show_intro` | ShowIntro |
| `create_golden_rules` | GoldenRules |
<!-- ported-patterns:end -->

## Tool contract

Read the pattern's system.md file:

```bash
PATTERN_NAME="[selected_pattern]"
CONFIG_ROOT="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
PATTERN_PATH="$CONFIG_ROOT/skills/Fabric/Patterns/$PATTERN_NAME/system.md"
LOCAL_PATH="$CONFIG_ROOT/WORKOS/USER/CUSTOMIZATIONS/SKILLS/Fabric/Patterns/$PATTERN_NAME/system.md"

if [ -f "$PATTERN_PATH" ]; then
  cat "$PATTERN_PATH"
elif [ -f "$LOCAL_PATH" ]; then
  cat "$LOCAL_PATH"
else
  echo "Pattern not found: $PATTERN_NAME"
  echo "Available patterns:"
  ls "$CONFIG_ROOT/skills/Fabric/Patterns/" | head -20
fi
```

The install's own patterns (the principal's local-only ones, which never ship) live in `<configRoot>/WORKOS/USER/CUSTOMIZATIONS/SKILLS/Fabric/Patterns/<name>/system.md` and are read only when the skill's `Patterns/` has no pattern of that name, so an upstream pattern always wins.

**Native Execution (Preferred):** each system.md is laid out as IDENTITY AND PURPOSE, STEPS and OUTPUT INSTRUCTIONS.

Both CLI cases need the fabric binary, which builds from the `cmd/fabric` package (per the upstream README checked 2026-10-10):
```bash
go install github.com/danielmiessler/fabric/cmd/fabric@latest
```

**YouTube URLs:**
```bash
fabric -y "YOUTUBE_URL" -p [pattern_name]
```
The `-y` flag extracts the transcript automatically.

**URLs the native fetch cannot extract (heavy client-side rendering):**
```bash
fabric -u "URL" -p [pattern_name]
```
Use when native URL fetching returns no usable page content. Both `fabric -y` and `fabric -u` need web egress and the fabric CLI; inside the WorkOS sandbox neither is usually available, so ask for the transcript or page text instead. A site that blocks automated access (CAPTCHA, bot challenge, robots or terms refusal) is respected and not retried through another path.

## Output format

The pattern output follows that pattern's own OUTPUT INSTRUCTIONS (for example extract_wisdom's SUMMARY, IDEAS, INSIGHTS, QUOTES, HABITS, FACTS, REFERENCES and RECOMMENDATIONS sections); this file does not restate them.

### Error Handling

**Pattern not found:**
```
Pattern '[name]' not found in ~/.claude/skills/Fabric/Patterns/ or the install's local Patterns/

Similar patterns:
- [suggestion 1]
- [suggestion 2]

Run 'update fabric' to sync latest patterns.
```

**No content provided:**
```
No content provided for pattern execution.
Please provide:
- Text directly
- URL to fetch
- YouTube URL (use fabric -y)
- File path to read
```

## References

- `Patterns/pattern_explanations.md`: one line per pattern, by name, for finding a pattern the selection table does not list.

Pattern categories (the full set is `Patterns/pattern_explanations.md`):

### Extraction (30+)
`extract_wisdom`, `extract_insights`, `extract_main_idea`, `extract_recommendations`, `extract_article_wisdom`, `extract_book_ideas`, `extract_predictions`, `extract_questions`, `extract_controversial_ideas`, `extract_business_ideas`, `extract_skills`, `extract_patterns`, `extract_references`, `extract_instructions`, `extract_primary_problem`, `extract_primary_solution`, `extract_product_features`, `extract_core_message`

### Summarization (20+)
`summarize`, `create_5_sentence_summary`, `create_micro_summary`, `summarize_meeting`, `summarize_paper`, `summarize_lecture`, `summarize_debate`, `youtube_summary`, `summarize_git_changes`, `summarize_git_diff`

### Analysis (35+)
`analyze_claims`, `analyze_malware`, `analyze_paper`, `analyze_logs`, `analyze_debate`, `analyze_incident`, `analyze_comments`, `analyze_email_headers`, `analyze_personality`, `analyze_presentation`, `analyze_product_feedback`, `analyze_prose`, `analyze_risk`, `analyze_sales_call`, `analyze_threat_report`, `analyze_bill`, `analyze_candidates`

### Creation (50+)
`create_threat_model`, `create_stride_threat_model`, `create_prd`, `create_design_document`, `create_user_story`, `create_mermaid_visualization`, `create_markmap_visualization`, `create_visualization`, `create_sigma_rules`, `create_report_finding`, `create_keynote`, `create_academic_paper`, `create_flash_cards`, `create_quiz`, `create_art_prompt`, `create_command`, `create_pattern`

### Improvement (10+)
`improve_writing`, `improve_academic_writing`, `improve_prompt`, `improve_report_finding`, `review_code`, `review_design`, `refine_design_document`, `humanize`, `enrich_blog_post`, `clean_text`

### Security (15)
`create_threat_model`, `create_stride_threat_model`, `create_threat_scenarios`, `create_security_update`, `create_sigma_rules`, `write_nuclei_template_rule`, `write_semgrep_rule`, `analyze_threat_report`, `analyze_malware`, `analyze_incident`, `analyze_risk`

### Rating/Evaluation (8)
`rate_ai_response`, `rate_content`, `rate_value`, `judge_output`, `label_and_rate`, `check_agreement`
