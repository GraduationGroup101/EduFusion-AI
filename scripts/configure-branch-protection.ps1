param([string]$Repository = 'GraduationGroup101/EduFusion-AI')
$ErrorActionPreference = 'Stop'
# Run after CI / verify has completed on a pushed branch. Requires GitHub
# repository administration permission in the local gh authentication session.
$protection = @{
  required_status_checks = @{ strict = $true; contexts = @('verify') }
  enforce_admins = $true
  required_pull_request_reviews = @{ required_approving_review_count = 1; dismiss_stale_reviews = $true }
  restrictions = $null
  required_conversation_resolution = $true
  allow_force_pushes = $false
  allow_deletions = $false
} | ConvertTo-Json -Depth 5
$protection | gh api --method PUT "repos/$Repository/branches/main/protection" --input -
if ($LASTEXITCODE -ne 0) { throw 'Branch protection was not applied; check GitHub authentication and administration permission.' }
