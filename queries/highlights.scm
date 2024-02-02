; List of tokens supported by vscode:
; https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide#standard-token-types-and-modifiers
; we treat the first identifier as the token type, and everything else as token modifiers.
; The scope "foo.bar.baz" means { type: "foo", modifiers: ["bar", "baz"] }

; Additional tokens are defined in package.json:
; * punctuation
; * punctuationBracket
; * control
; * error

; Types

(clazz (identifier) @class)
(typeAlias (identifier) @type)
((identifier) @type
 (match? @type "^[A-Z]"))
(moduleClause (qualifiedIdentifier (identifier) @type))

(annotation "@" @class)

(typeArgumentList
  "<" @bracket
  ">" @bracket)

(typeParameter (identifier) @type)
(typeAnnotation (type (qualifiedIdentifier) @type))
(newExpr (type (qualifiedIdentifier) @type))

; Method calls

(methodCallExpr
  (identifier) @method)

; Method definitions

(classMethod (methodHeader (identifier) @method))
(objectMethod (methodHeader (identifier) @method))

; Identifiers

(classProperty (identifier) @property)
(objectProperty (identifier) @property)

(parameterList (typedIdentifier (identifier) @parameter))
(objectBodyParameters (typedIdentifier (identifier) @parameter))

(annotation (qualifiedIdentifier (identifier) @decorator))
(annotation "@" @decorator)

(forGenerator (typedIdentifier (identifier) @variable))
(letExpr (typedIdentifier (identifier) @variable))
(variableExpr (identifier) @variable)
(importClause (identifier) @variable)
(importGlobClause (identifier) @variable)
(variableObjectLiteral (identifier) @variable)
(propertyCallExpr (identifier) @variable)

; Literals

(stringConstant) @string
(slStringLiteral) @string
(mlStringLiteral) @string

(interpolationExpr
  "\\(" @stringEscape
  ")" @stringEscape) @none

(interpolationExpr
 "\\#(" @stringEscape
 ")" @stringEscape) @none

(interpolationExpr
  "\\##(" @stringEscape
  ")" @stringEscape) @none

(escapeSequence) @stringEscape

(intLiteral) @number
(floatLiteral) @number

; Operators

"??" @operator
"="  @operator
"<"  @operator
">"  @operator
"!"  @operator
"==" @operator
"!=" @operator
"<=" @operator
">=" @operator
"&&" @operator
"||" @operator
"+"  @operator
"-"  @operator
"**" @operator
"*"  @operator
"/"  @operator
"~/" @operator
"%"  @operator
"|>" @operator


"|"  @operator
"->" @operator

"," @punctuation
":" @punctuation
"." @punctuation
"?." @punctuation
"...?" @punctuation
"..." @punctuation

"(" @bracket
")" @bracket
"]" @bracket
"{" @bracket
"}" @bracket

; Keywords

"amends" @keyword
"as" @keyword
"extends" @keyword
(trueLiteral) @constant
(falseLiteral) @constant
(nullLiteral) @constant
"if" @control
"else" @control
"import*" @keyword
"import" @keyword
(importExpr "import" @keyword)
(importGlobExpr "import*" @keyword)
(readExpr "read" @keyword)
(readGlobExpr "read*" @keyword)
(readOrNullExpr "read?" @keyword)
(traceExpr "trace" @keyword)
(throwExpr "throw" @keyword)
(moduleExpr "module" @type.defaultLibrary)
"nothing" @type.defaultLibrary
(outerExpr) @variable.defaultLibrary
"super" @variable.defaultLibrary
(thisExpr) @variable.builtin
"unknown" @type.builtin
(ERROR) @error
