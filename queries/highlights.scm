; Copyright © 2024-2025 Apple Inc. and the Pkl project authors. All rights reserved.
;
; Licensed under the Apache License, Version 2.0 (the "License");
; you may not use this file except in compliance with the License.
; You may obtain a copy of the License at
;
;   https://www.apache.org/licenses/LICENSE-2.0
;
; Unless required by applicable law or agreed to in writing, software
; distributed under the License is distributed on an "AS IS" BASIS,
; WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
; See the License for the specific language governing permissions and
; limitations under the License.

(clazz (identifier) @class)
(typeAlias (identifier) @type)
(declaredType (qualifiedIdentifier (identifier) @type))
(moduleClause (qualifiedIdentifier (identifier) @type))
(annotation "@" @decorator (qualifiedIdentifier) @decorator)
(typeArgumentList
  "<" @bracket
  ">" @bracket)

(typeParameter (identifier) @type)

(unqualifiedAccessExpr
  (identifier) @method (argumentList))

(unqualifiedAccessExpr
  (identifier) @property)

(qualifiedAccessExpr
  (identifier) @method (argumentList))

(qualifiedAccessExpr
  (identifier) @property)

(classMethod (methodHeader (identifier) @method))
(objectMethod (methodHeader (identifier) @method))

(classProperty (identifier) @property)
(objectProperty (identifier) @property)

(typedIdentifier (identifier) @parameter)

(forGenerator (typedIdentifier (identifier) @variable))
(letExpr (typedIdentifier (identifier) @variable))

(importClause (identifier) @variable)
(importGlobClause (identifier) @variable)

(stringConstant) @string
(slStringLiteralPart) @string
(mlStringLiteralPart) @string

(stringInterpolation
  "\\(" @stringEscape
  ")" @stringEscape) @none

(stringInterpolation
 "\\#(" @stringEscape
 ")" @stringEscape) @none

(stringInterpolation
  "\\##(" @stringEscape
  ")" @stringEscape) @none

"\"" @string
"#\"" @string
"##\"" @string
"###\"" @string
"####\"" @string
"#####\"" @string
"\"#" @string
"\"##" @string
"\"###" @string
"\"####" @string
"\"#####" @string

(escapeSequence) @stringEscape

(intLiteralExpr) @number
(floatLiteralExpr) @number


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


"amends" @keyword
"as" @keyword
"extends" @keyword
"class" @keyword
"typealias" @keyword
"function" @keyword
"module" @keyword
(trueLiteralExpr) @constant
(falseLiteralExpr) @constant
(nullLiteralExpr) @constant
"new" @control
"if" @control
"else" @control
"import*" @keyword
"import" @keyword
(importExpr "import" @keyword)
(importExpr "import*" @keyword)
(readExpr "read" @keyword)
(readExpr "read*" @keyword)
(readExpr "read?" @keyword)
(traceExpr "trace" @keyword)
(throwExpr "throw" @keyword)
(moduleExpr "module" @type.defaultLibrary)
(unknownType) @type.defaultLibrary
(nothingType) @type.defaultLibrary
(moduleType) @type.defaultLibrary
(outerExpr) @variable.defaultLibrary
"super" @variable.defaultLibrary
(thisExpr) @variable.builtin
(ERROR) @error
