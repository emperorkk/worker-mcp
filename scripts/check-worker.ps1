param(
  [Parameter(Mandatory = $true)]
  [string]$BaseUrl,

  [Parameter(Mandatory = $true)]
  [string]$McpSecret,

  [ValidateSet('bearer','header')]
  [string]$AuthMethod = 'bearer',

  [int]$Trdr = 1000
)

$ErrorActionPreference = 'Stop'

function Write-Pass($message) {
  Write-Host "✅ $message" -ForegroundColor Green
}

function Write-Fail($message) {
  Write-Host "❌ $message" -ForegroundColor Red
}

function Invoke-JsonPost {
  param(
    [string]$Url,
    [hashtable]$Headers,
    [object]$Body
  )

  $json = $Body | ConvertTo-Json -Depth 10
  return Invoke-WebRequest -Uri $Url -Method Post -Headers $Headers -ContentType 'application/json' -Body $json
}

function Assert-StatusCode {
  param(
    $Response,
    [int]$Expected,
    [string]$CheckName
  )

  if ($Response.StatusCode -ne $Expected) {
    throw "$CheckName expected HTTP $Expected but got $($Response.StatusCode)"
  }
}

$root = $BaseUrl.TrimEnd('/')
$healthUrl = "$root/health"
$mcpUrl = "$root/mcp"

Write-Host "Running checks against: $root"

# 1) Health
try {
  $health = Invoke-WebRequest -Uri $healthUrl -Method Get
  Assert-StatusCode -Response $health -Expected 200 -CheckName 'health'
  $healthJson = $health.Content | ConvertFrom-Json
  if ($healthJson.status -ne 'ok') {
    throw "health status expected 'ok' but got '$($healthJson.status)'"
  }
  Write-Pass 'GET /health'
} catch {
  Write-Fail "GET /health - $($_.Exception.Message)"
}

# 2) Unauthorized initialize
try {
  $unauthBody = @{ jsonrpc = '2.0'; id = 1; method = 'initialize'; params = @{} }
  $unauth = Invoke-JsonPost -Url $mcpUrl -Headers @{} -Body $unauthBody
  throw "Expected 401 but got HTTP $($unauth.StatusCode)"
} catch {
  if ($_.Exception.Response -and $_.Exception.Response.StatusCode.value__ -eq 401) {
    Write-Pass 'POST /mcp without auth returns 401'
  } else {
    Write-Fail "POST /mcp without auth - $($_.Exception.Message)"
  }
}

$authHeaders = @{}
if ($AuthMethod -eq 'bearer') {
  $authHeaders['Authorization'] = "Bearer $McpSecret"
} else {
  $authHeaders['x-mcp-secret'] = $McpSecret
}

# 3) initialize
try {
  $initializeBody = @{ jsonrpc = '2.0'; id = 2; method = 'initialize'; params = @{} }
  $initialize = Invoke-JsonPost -Url $mcpUrl -Headers $authHeaders -Body $initializeBody
  Assert-StatusCode -Response $initialize -Expected 200 -CheckName 'initialize'
  $initializeJson = $initialize.Content | ConvertFrom-Json
  if ($initializeJson.result.serverInfo.name -ne 'worker-mcp') {
    throw "serverInfo.name expected 'worker-mcp' but got '$($initializeJson.result.serverInfo.name)'"
  }
  Write-Pass 'POST /mcp initialize'
} catch {
  Write-Fail "POST /mcp initialize - $($_.Exception.Message)"
}

# 4) tools/list
try {
  $listBody = @{ jsonrpc = '2.0'; id = 3; method = 'tools/list'; params = @{} }
  $list = Invoke-JsonPost -Url $mcpUrl -Headers $authHeaders -Body $listBody
  Assert-StatusCode -Response $list -Expected 200 -CheckName 'tools/list'
  $listJson = $list.Content | ConvertFrom-Json
  $toolNames = @($listJson.result.tools | ForEach-Object { $_.name })
  if (-not ($toolNames -contains 'getCustomer' -and $toolNames -contains 'searchCustomers')) {
    throw "tools/list did not include expected tools. Found: $($toolNames -join ', ')"
  }
  Write-Pass 'POST /mcp tools/list'
} catch {
  Write-Fail "POST /mcp tools/list - $($_.Exception.Message)"
}

# 5) searchCustomers stub
try {
  $searchBody = @{
    jsonrpc = '2.0'
    id = 4
    method = 'tools/call'
    params = @{
      name = 'searchCustomers'
      arguments = @{ query = 'test' }
    }
  }
  $search = Invoke-JsonPost -Url $mcpUrl -Headers $authHeaders -Body $searchBody
  Assert-StatusCode -Response $search -Expected 200 -CheckName 'tools/call searchCustomers'
  $searchJson = $search.Content | ConvertFrom-Json
  $textPayload = $searchJson.result.content[0].text | ConvertFrom-Json
  if ($textPayload.status -ne 'needs_softone_browser_config') {
    throw "searchCustomers expected status needs_softone_browser_config but got '$($textPayload.status)'"
  }
  Write-Pass 'POST /mcp tools/call searchCustomers'
} catch {
  Write-Fail "POST /mcp tools/call searchCustomers - $($_.Exception.Message)"
}

# 6) getCustomer
try {
  $getBody = @{
    jsonrpc = '2.0'
    id = 5
    method = 'tools/call'
    params = @{
      name = 'getCustomer'
      arguments = @{ trdr = $Trdr }
    }
  }
  $get = Invoke-JsonPost -Url $mcpUrl -Headers $authHeaders -Body $getBody
  Assert-StatusCode -Response $get -Expected 200 -CheckName 'tools/call getCustomer'
  $getJson = $get.Content | ConvertFrom-Json
  $text = $getJson.result.content[0].text | ConvertFrom-Json

  if ($text.status -eq 'not_found') {
    Write-Pass "POST /mcp tools/call getCustomer (TRDR $Trdr not found, request path works)"
  } else {
    $required = @('CODE','NAME','ADDRESS','CITY','COUNTRY','AFM')
    foreach ($field in $required) {
      if (-not ($text.PSObject.Properties.Name -contains $field)) {
        throw "getCustomer response missing field '$field'"
      }
    }
    Write-Pass "POST /mcp tools/call getCustomer (TRDR $Trdr returned customer fields)"
  }
} catch {
  Write-Fail "POST /mcp tools/call getCustomer - $($_.Exception.Message)"
}

Write-Host 'Done.'
