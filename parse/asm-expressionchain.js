'use strict';

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['exports'], factory);
  } else if (typeof exports !== 'undefined') {
    factory(exports);
  } else {
    factory((root.asmExpressionChain = {}));
  }
}(this, function (exports) {
  var BinaryPrecedences = ([
    ["*", "/", "%"],
    ["+", "-"],
    ["<<", ">>", ">>>"],
    ["<", "<=", ">", ">=", "in", "instanceof"],
    ["==", "!=", "===", "!=="],
    ["&"], ["^"], ["|"], ["&&"], ["||"]
  ]).map(function (p) {
    var result = Object.create(null);
    for (var i = 0, l = p.length; i < l; i++)
      result[p[i]] = true;
    return result;
  });


  function ChainExpressionNode (e) {
    this.expression = e;
  };

  function ChainOperatorNode (o) {
    this.operator = o;
  };


  function ExpressionChain (treeBuilder, trace) {
    this.items = [];
    this.builder = treeBuilder;
    this.trace = trace || false;
  };

  ExpressionChain.prototype.abort = function (msg) {
    this.log(true);
    throw new Error(msg);
  };

  ExpressionChain.prototype.pushExpression = function (e) {
    this.items.push(new ChainExpressionNode(e));
  };

  ExpressionChain.prototype.pushOperator = function (o) {
    this.items.push(new ChainOperatorNode(o));
  };

  ExpressionChain.prototype.isExpression = function (i) {
    var n = this.items[i];
    return (n instanceof ChainExpressionNode);
  };

  ExpressionChain.prototype.isOperator = function (i) {
    var n = this.items[i];
    return (n instanceof ChainOperatorNode);
  };

  ExpressionChain.prototype.at = function (i) {
    var n = this.items[i];

    if (n instanceof ChainExpressionNode)
      return n.expression;
    else if (n instanceof ChainOperatorNode)
      return n.operator;
    else
      return null;
  };

  ExpressionChain.prototype.replaceWithExpression = function (first, last, expression) {
    var count = (last - first) + 1;
    var node = new ChainExpressionNode(expression);
    this.items.splice(first, count, node);
  };
  
  ExpressionChain.prototype.log = function (force) {
    if (this.trace || force)
      console.log("chain", this.items);      
  }

  ExpressionChain.prototype.applyDecrementAndIncrement = function () {
    this.log();

    for (var i = 0; i < this.length; i++) {
      switch (this.at(i)) {
        case "++":
        case "--":
          var newExpression;
          var isPrefix = this.isExpression(i + 1);
          var isPostfix = this.isExpression(i - 1);

          // FIXME: This doesn't detect and reject scenarios where the ++/--
          //  operators are being used on a non-identifier, but that's probably fine

          if (isPostfix) {
            newExpression = this.builder.makePostfixMutationExpression(
              this.at(i),
              this.at(i - 1)
            );
            this.replaceWithExpression(i - 1, i, newExpression)
            i -= 1;
          } else if (isPrefix) {
            newExpression = this.builder.makePrefixMutationExpression(
              this.at(i),
              this.at(i + 1)
            );
            this.replaceWithExpression(i, i + 1, newExpression)
          } else {
            return this.abort("Found a '" + this.at(i) + "' surrounded by operators");
          }

          break;
      }
    }
  };

  ExpressionChain.prototype.applyUnaryOperators = function () {
    this.log();

    for (var i = this.length - 2; i >= 0; i--) {
      switch (this.at(i)) {
        case "+":
        case "-":
          if (this.isExpression(i - 1) &&
              this.isExpression(i + 1)) {
            // This is binary arithmetic, so don't process it here
            break;
          } else {
            // Fall-through
          }

        case "!":
        case "~":
        case "typeof":
        case "void":
        case "delete":
        case "new":
          if (!this.isExpression(i + 1))
            return this.abort("Found a prefix operator before a non-expression");

          var rhs = this.at(i + 1);
          var newExpression = this.builder.makeUnaryOperatorExpression(
            this.at(i),
            this.at(i + 1)
          );

          this.replaceWithExpression(i, i + 1, newExpression);

          break;
      }
    }
  };

  ExpressionChain.prototype.applyBinaryOperators = function () {
    this.log();

    for (var p = 0; p < BinaryPrecedences.length; p++) {
      var table = BinaryPrecedences[p];

      for (var i = 1; i < (this.length - 1); i++) {
        if (!this.isOperator(i))
          continue;

        if (table[this.at(i)]) {
          if (
            !this.isExpression(i - 1) ||
            !this.isExpression(i + 1)
          )
            return this.abort("Found a binary operator without a lhs & rhs");

          var lhs = this.at(i - 1);
          var rhs = this.at(i + 1);
          var newExpression = this.builder.makeBinaryOperatorExpression(
            this.at(i),
            lhs, rhs
          );

          this.replaceWithExpression(i - 1, i + 1, newExpression);
          i -= 1;       
        }
      }

    }
  };

  /*
    A
      ? a
      : b

    [A ? a : b]

    A
      ? 
        B
          ? a
          : b
      : c

    [A ? B ? a : b : c]
  */

  ExpressionChain.prototype.applyTernaryOperator = function () {
    this.log();

    for (var i = this.length - 2; i >= 0; i--) {
      if (!this.isOperator(i))
        continue;

      var op = this.at(i);

      if (op === ":") {
        // Scan for an ? and parse there to properly apply associativity
        continue;
      }

      if (op === "?") {
        var condition = this.at(i - 1);
        var trueValue = this.at(i + 1);
        var colon = this.at(i + 2);
        var falseValue = this.at(i + 3);

        if (colon !== ":") {
          console.log(i, this.items);
          return this.abort("Expected : in ternary expression but found " + colon);
        }

        var newExpression = this.builder.makeTernaryOperatorExpression(
          condition, trueValue, falseValue
        );
        this.replaceWithExpression(i - 1, i + 3, newExpression);

        // FIXME: Not sure about this
        i -= 1;
      }
    }
  };

  ExpressionChain.prototype.applyAssignmentOperators = function () {
    this.log();

    for (var i = 1; i < (this.length - 1); i++) {
      switch (this.at(i)) {
        case "=":
        case "+=":
        case "-=":
        case "*=":
        case "/=":
        case "%=":
        case "<<=":
        case ">>=":
        case ">>>=":
        case "&=":
        case "^=":
        case "|=":
          if (
            !this.isExpression(i - 1) ||
            !this.isExpression(i + 1)
          )
            return this.abort("Found an assignment operator without a lhs & rhs");

          // TODO: Assert that LHS is an identifier?

          var lhs = this.at(i - 1);
          var rhs = this.at(i + 1);
          var newExpression = this.builder.makeAssignmentOperatorExpression(
            this.at(i),
            lhs, rhs
          );

          this.replaceWithExpression(i - 1, i + 1, newExpression);
          i -= 1;
          break;
      }
    }
  };

  ExpressionChain.prototype.applyCommaOperator = function () {
    if (this.length === 1)
      return;

    this.log();

    var expressions = [];

    for (var i = 0; i < this.length; i++) {
      if (!this.isOperator(i)) {
        var expr = this.at(i);

        expressions.push(expr);
      } else {
        var op = this.at(i);

        if (op !== ",") {
          // Bail out; we hit a non-expression that isn't a , operator
          // The caller will notice it has an unresolved chain and abort
          return;
        }
      }
    }

    var newExpression = this.builder.makeCommaExpression(expressions);
    this.replaceWithExpression(0, this.length - 1, newExpression);
  };

  Object.defineProperty(ExpressionChain.prototype, "length", {
    enumerable: true,
    configurable: false,
    get: function () {
      return this.items.length;
    },
    set: function (l) {
      this.items.length = l;
    }
  });


  exports.ExpressionChain = ExpressionChain;
}));