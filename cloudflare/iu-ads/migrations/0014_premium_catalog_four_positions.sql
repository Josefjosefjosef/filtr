-- Premium sales catalog always offers P1–P4 (legacy premium_capacity unlock removed).
UPDATE premium_selected_categories
SET premium_capacity = 4,
    updated_at = datetime('now')
WHERE premium_capacity = 2;
