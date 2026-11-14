# College API (`https://ht.knowvally.com`, spec in `docs/openapi.json`)

Headers: `X-Participant-Key` on every call; `Authorization: Bearer` (from `POST /v1/auth/login`, valid 8 hours) for `/v1/me/*`, `/v1/teacher/*` and `/v1/calendar`. `Idempotency-Key` on POSTs. Errors: `{"error":{code,message,field}}`.

| Tool | Endpoint | Roles |
|---|---|---|
| get_today, get_college_info, list_courses, list_placement_drives | GET /v1/today, /college, /courses, /placements/drives | all |
| submit_admission_application | POST /v1/admissions/applications | public |
| get_my_profile, get_calendar | GET /v1/me, /v1/calendar | student, teacher |
| get_my_academics, get_my_subjects, get_my_timetable, get_my_attendance, get_attendance_sessions | GET /v1/me/{academics,subjects,timetable,attendance,attendance/sessions} | student |
| list_my_requests, get_my_request, submit_leave_or_od_request, cancel_my_request | GET/POST /v1/me/requests[/{id}[/cancel]] | student |
| register_for_placement_drive, list_my_placements | POST /v1/placements/drives/{id}/register, GET /v1/me/placements | student |
| list_my_classes, list_student_requests, get_class_attendance, approve_student_request, reject_student_request | /v1/teacher/... | teacher |

Documents (`/v1/documents`, `/{id}/file`) are loaded by `knowledge/`, not exposed as tools.

## Sandbox facts (for testing)
- College date: 2026-11-21, a Saturday.
- arjun (CSE-2A, B.Tech year 2): 76% in CS304 (38 of 50). DBMS internal assessment on 2026-11-23. Existing on-duty request 42 (30 Nov) is pending.
- lakshmi advises CSE-2A.
- Placement drives are open to 4th-year students only, so arjun is not eligible.
- Test-run residue: arjun's on-duty requests 108 and 109 (3 and 4 Dec), both created and then cancelled.
