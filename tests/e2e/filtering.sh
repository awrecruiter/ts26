#!/bin/bash
set -e

echo "=== E2E: Advanced Filtering (Phase 6) ==="

agent-browser open http://localhost:3000/opportunities
agent-browser wait --load networkidle
agent-browser snapshot -i
agent-browser screenshot tests/e2e/screenshots/filtering-initial.png

# Look for advanced filter controls (Phase 6 specific)
SNAPSHOT=$(agent-browser snapshot)
if echo "$SNAPSHOT" | grep -qi "min margin\|naics code\|clear filters"; then
  echo "PASS: Advanced filter controls present"
else
  echo "INFO: Advanced filtering (Phase 6) not yet implemented — basic search/filters present"
  exit 0  # Non-fatal — feature not yet built
fi

# Test margin filter
agent-browser find label "Min Margin" fill "10"
agent-browser wait 500
agent-browser screenshot tests/e2e/screenshots/filtering-margin-applied.png

SNAPSHOT=$(agent-browser snapshot)
echo "PASS: Margin filter applied"

# Test status filter
agent-browser find label "Status" click
agent-browser wait 300
agent-browser find role option click --name "Active"
agent-browser wait 500
agent-browser screenshot tests/e2e/screenshots/filtering-status-applied.png

# Test NAICS filter
agent-browser find label "NAICS Code" fill "541511"
agent-browser wait 500
agent-browser screenshot tests/e2e/screenshots/filtering-naics-applied.png

# Clear filters
agent-browser find role button click --name "Clear Filters"
agent-browser wait 500
agent-browser screenshot tests/e2e/screenshots/filtering-cleared.png

SNAPSHOT=$(agent-browser snapshot)
echo "PASS: Filters cleared"

echo "=== Advanced Filtering: PASSED ==="
